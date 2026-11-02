---
title: "webhacking.kr old-51 풀이 — md5(pw, true)와 매직 해시(ffifdyop)로 뚫는 로그인"
description: "webhacking.kr old-51을 통해 비밀번호를 md5($pw, true)의 원시 바이너리로 만들어 SQL에 그대로 끼워 넣는 로그인 로직의 허점, 그리고 raw MD5가 'or'6…로 시작하는 매직 해시 ffifdyop로 인증을 우회하는 과정을 직접 풀어 정리한다."
date: 2026-11-02
category: Web
tags: [webhacking.kr, web, wargame, sql-injection, magic-hash, authentication, php, mysql]
---

[webhacking.kr](https://webhacking.kr)의 **old-51** 문제를 풀었다.
겉보기엔 평범한 관리자 로그인 폼이지만, 핵심은 비밀번호를 **`md5($pw, true)`**,
즉 **원시 바이너리(raw binary)로 만들어 SQL 문자열에 그대로 끼워 넣는다**는 점이다.
`addslashes`로 따옴표를 막아도, **해시 결과 안에 들어 있는 따옴표**는 막을 수 없다.
그래서 **raw MD5가 `'or'6…`로 시작하는 입력 한 개**(`ffifdyop`)면 로그인이 뚫린다.
이른바 **매직 해시(magic hash)** 공격이다.

아래 내용은 전부 **실제로 서버에 넣어 통과를 확인한 것**이다.

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 사이트 | webhacking.kr (old) |
| 문제 | old-51 (`/challenge/bonus-13/`) |
| 유형 | SQL 인젝션 / 인증 우회 (매직 해시) |
| 배점 | 25점 |
| 목표 | `select`가 **행을 하나라도 반환**하도록 만들어 통과(`solve(51)`) |

페이지는 `ID`/`PW` 입력이 있는 **Admin page**다. 아무 값이나 넣으면 **`Wrong`** 이 뜬다.

## 2. 정보 수집 — 소스 코드

하단 `view-source`로 전체 로직이 공개된다.

```php
<?php
  if($_POST['id'] && $_POST['pw']){
    $db = dbconnect();
    $input_id = addslashes($_POST['id']);      // id는 따옴표 이스케이프
    $input_pw = md5($_POST['pw'], true);       // pw는 'raw binary' MD5
    $result = mysqli_fetch_array(mysqli_query($db,
      "select id from chall51 where id='{$input_id}' and pw='{$input_pw}'"));
    if($result['id']) solve(51);               // 행이 반환되면 통과
    if(!$result['id']) echo "Wrong";
  }
?>
```

여기서 두 입력이 **완전히 다르게** 처리된다.

- **`id`**: `addslashes`로 `'` → `\'` 처리 → 따옴표로 질의를 깨뜨릴 수 없다.
- **`pw`**: `md5($_POST['pw'], true)`. 두 번째 인자 `true`가 핵심이다.
  이건 **32자 16진수 문자열이 아니라, 16바이트 원시 바이너리**를 돌려준다.
  그 바이너리가 **어떤 이스케이프도 거치지 않고** 질의의 `pw='...'` 안에 그대로 들어간다.

## 3. 문제점 — raw MD5 안에 따옴표가 들어 있으면?

`md5($x, true)`는 16바이트짜리 **아무 바이트나** 나올 수 있다 — 거기엔 작은따옴표(`0x27`)도,
`or` 같은 글자 바이트도 포함될 수 있다. 그리고 이 값은 **이스케이프되지 않은 채**
`pw='<여기>'` 자리에 들어간다. 즉 **비밀번호 해시 자체가 SQL 인젝션 페이로드가 될 수 있다.**

여기서 유명한 입력이 **`ffifdyop`** 이다. `md5("ffifdyop")`의 16진수는

```text
276f722736c95d99e921722cf9ed621c
```

이걸 **바이트(raw binary)로** 읽으면 앞부분이 이렇게 된다.

| 16진수 | `27` | `6f` | `72` | `27` | `36` | `c9` | `5d` | … |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 문자 | `'` | `o` | `r` | `'` | `6` | (바이너리) | (바이너리) | … |

즉 raw MD5가 **`'or'6…`** 로 시작한다. 이걸 질의에 끼우면 `pw` 비교 부분이 이렇게 된다.

```sql
... and pw=''or'6<바이너리>...'
```

## 4. 익스플로잇 — 페이로드 설계와 검증

`and pw=''or'6…'` 를 논리적으로 풀어 보면 다음과 같다.

```sql
select id from chall51 where id='admin' and pw='' or '6<...>'
```

- `and`가 `or`보다 **우선순위가 높으므로** → `(id='admin' and pw='') or '6<...>'`
- `pw=''`는 거짓이지만, 뒤의 **`'6<...>'`** 는 숫자 `6`으로 시작하는 **비어 있지 않은 문자열** →
  MySQL에서 **참(truthy)** 으로 평가된다.
- 결국 `(거짓) or (참)` → **WHERE 전체가 참** → 테이블의 행이 반환된다.

`$result['id']`가 채워지므로 `solve(51)`이 호출된다.
`id`는 `admin`이든 아무 값이든 상관없다(뒤의 `or '6…'`가 조건을 참으로 만들기 때문).

### 실제 전송 — 검증

먼저 평범한 틀린 비밀번호로 **기준선**을 확인했다.

```console
POST id=admin & pw=wrongpw
→ Wrong
```

그다음 매직 해시 입력을 넣었다.

```console
POST id=admin & pw=ffifdyop
→ old-51 Pwned. You got 25point. Congratz!
```

## 5. 결과

`pw=ffifdyop` 한 번으로 WHERE 절이 참이 되어 행이 반환되고 통과했다.

```
old-51 Pwned. You got 25point. Congratz!
```

문제 목록(`chall.php`)에서도 **`✔️ old-51`** 로 풀린 것을 확인했다.

> `id`를 `addslashes`로 아무리 막아도 소용없었다. 구멍은 **이스케이프하지 않은 `pw` 쪽**,
> 그중에서도 **raw MD5 안에 섞여 들어온 따옴표**였다.

## 6. 왜 취약한가 — 그리고 올바른 방어

**(1) 해시/바이너리 값도 "신뢰할 수 없는 입력"이다 — 그대로 질의에 넣지 마라.**
`md5(..., true)`의 결과는 임의 바이트라서 따옴표·역슬래시가 들어갈 수 있다.
`addslashes`는 입력 문자열에만 작동할 뿐, **그 뒤에 만들어지는 바이너리**는 손대지 못한다.

```php
// 나쁨: raw 바이너리를 이스케이프 없이 질의에 삽입
$input_pw = md5($_POST['pw'], true);
$q = "... and pw='{$input_pw}'";

// 좋음: 애초에 값을 질의 문법과 분리(바인딩)
$stmt = $db->prepare("select id from chall51 where id=? and pw=?");
$stmt->bind_param("ss", $_POST['id'], md5($_POST['pw'], true)); // 바인딩이면 바이너리도 안전
```

**(2) 비밀번호는 솔트 있는 전용 해시로 저장·검증한다.**
raw MD5를 문자열 비교로 쓰는 설계 자체가 약하다. `password_hash()`/`password_verify()`처럼
**솔트가 포함된 검증 함수**를 쓰면, 문자열 비교를 직접 조립할 일도, 매직 해시가 끼어들 틈도 없다.

**(3) 인증은 "행이 반환됐나"가 아니라 "정확히 그 사용자가 맞나"로 판단한다.**
`if($result['id'])`처럼 **행 존재 여부**만 보면, 인젝션으로 아무 행이나 반환시키는 순간 뚫린다.

## 7. 정리

- old-51은 `pw`를 **`md5($pw, true)` 원시 바이너리**로 만들어 **이스케이프 없이** `pw='...'`에 넣는 게 허점이다.
- `addslashes`는 `id`만 막을 뿐, **raw MD5 안의 따옴표**는 막지 못한다.
- `ffifdyop`의 raw MD5는 **`'or'6…`** 로 시작 → `and pw=''or'6…'` → `(…) or '6…'` → **WHERE 참** → 행 반환 → 통과.
- 교훈: **바이너리/해시 값도 바인딩으로 넣고**, **비밀번호는 전용 해시 함수로 검증**하며, **"행이 있나"가 아니라 "그 사용자가 맞나"로 인증**한다.

> "따옴표를 이스케이프했는가"가 아니라 "질의에 들어가는 **모든 값**이 데이터로만 취급되는가"를 먼저 묻는다.
