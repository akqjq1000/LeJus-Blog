---
title: "webhacking.kr old-18 풀이 — 공백 필터를 우회하는 SQL 인젝션"
description: "webhacking.kr old-18을 통해 WHERE 절에 그대로 들어가는 사용자 입력이 어떻게 인젝션으로 이어지는지, 공백 필터를 어떻게 우회하는지, 그리고 왜 이런 코드가 취약한지를 정리한다."
date: 2026-10-21
category: Web
tags: [webhacking.kr, web, wargame, sql-injection, php, mysql]
---

[webhacking.kr](https://webhacking.kr)의 **old-18** 문제를 풀었다.
가장 고전적인 **SQL 인젝션** 입문 문제로, 사용자 입력이 `WHERE` 절에
**아무런 처리 없이 그대로** 들어갈 때 어떤 일이 벌어지는지,
그리고 **빈약한 필터링(공백 차단)** 이 왜 방어가 되지 못하는지를 보여준다.

"페이로드 하나 넣으면 끝"에서 멈추지 않고, **쿼리가 실제로 어떻게 조립되는지**
와 **연산자 우선순위** 까지 따라가며 왜 그 입력이 통하는지 정리한다.

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 사이트 | webhacking.kr (old) |
| 문제 | old-18 |
| 유형 | SQL Injection (공백 필터 우회) |
| 목표 | `guest`가 아닌 **`admin` 계정**을 조회해 통과 |

문제 페이지에는 번호를 입력받는 검색 폼이 하나 있고,
입력한 번호(`no`)로 회원을 조회해 그 결과가 `admin`이면 문제가 풀린다.

## 2. 소스 코드

문제에서 공개하는 핵심 로직은 대략 다음과 같다.

```php
<?php
  $db = dbconnect();
  if(preg_match('/ |\/|\(|\)|\t|%09|%0a|%0b|%0c|%0d/i', $_GET['no'])) exit("no hack");
  $result = mysqli_query($db, "select id from member where id='guest' and no=$_GET[no]");
  $data = mysqli_fetch_array($result);
  if($data['id'] == "guest") echo "hi guest";
  if($data['id'] == "admin"){
    solve(18);
    echo "hi admin!";
  }
?>
```

여기서 눈여겨볼 지점은 두 가지다.

1. `$_GET[no]`가 **따옴표도 없이** 쿼리에 그대로 삽입된다 → **숫자 컨텍스트 인젝션**.
2. 필터는 **공백류 문자와 괄호만** 막는다(`space`, `\t`, `/`, `(`, `)`, 그리고 URL 인코딩된 공백·개행 `%09`~`%0d`).
   즉 **키워드 자체(`or`, `and` …)나 다른 우회 수단은 막지 못한다.**

데이터베이스에는 `guest`(no=1)와 `admin`(no=2)이 있다고 가정한다.

## 3. 쿼리가 어떻게 조립되는가

정상 입력 `no=1`이면 쿼리는 이렇게 된다.

```sql
select id from member where id='guest' and no=1
```

`id='guest'` **그리고** `no=1` 이 모두 참이라 guest 행이 나온다. 여기서 중요한 건
**`admin` 행을 반환시키는 것** 인데, `id='guest'`가 앞에 고정돼 있어 그대로는 admin이 걸리지 않는다.

`OR`를 끼워 넣어 조건을 하나 더 만든다. 단순히 `no=2`만 주면
`id='guest' and no=2` → guest의 no는 1이므로 **거짓**, 아무것도 안 나온다.
그래서 **OR로 admin 행을 직접 겨냥** 해야 한다.

핵심은 **연산자 우선순위**다. SQL에서 `AND`가 `OR`보다 먼저 묶인다.

```sql
select id from member where (id='guest' and no=0) or (no=2)
```

앞 괄호는 거짓이지만 뒤의 `no=2`가 admin 행과 일치하므로 **admin이 반환**된다.

## 4. 공백 필터 우회

문제는 **공백을 쓸 수 없다**는 것. `no=0 or no=2`처럼 쓰면 `or` 양옆 공백에서 `no hack`으로 걸린다.
공백 없이 같은 논리를 만들면 된다 — MySQL의 **논리 연산자 `||`(= OR)** 는 공백이 필요 없다.

```
?no=0||no=2
```

조립되는 쿼리:

```sql
select id from member where id='guest' and no=0||no=2
```

우선순위에 따라 `(id='guest' and no=0) || (no=2)` 로 해석되고,
뒤 절이 admin 행과 일치해 **`admin`이 조회**된다. 공백·괄호를 하나도 쓰지 않았으니 필터도 통과한다.

> 참고: 공백 우회에는 인라인 주석 `/**/`도 흔히 쓰지만, 이 문제는 `/`까지 막으므로 쓸 수 없다.
> 그래서 **연산자만으로 공백을 없애는** 접근이 깔끔하다.

```console
GET /challenge/web-32/?no=0||no=2
→ hi admin!
<통과 — 공개 글에서는 플래그/인증 결과를 가림>
```

> 값은 가린다 — webhacking.kr에 직접 입력하면 점수가 올라간다.

## 5. 왜 취약한가 — 그리고 올바른 방어

이 문제의 본질은 **필터가 아니라 쿼리 조립 방식**에 있다.
블랙리스트(공백·괄호 차단)는 언제나 우회가 나온다(`||`, 주석, 인코딩, 개행 변형 …).

제대로 된 방어는 **입력을 쿼리 문자열에 섞지 않는 것** 이다 — **파라미터 바인딩(prepared statement)**.

```php
$stmt = $db->prepare("select id from member where id='guest' and no=?");
$stmt->bind_param("i", $_GET['no']);   // 정수로 바인딩
$stmt->execute();
```

이렇게 하면 `no`는 **데이터로만** 취급되어 `||no=2` 같은 입력이 쿼리 구조를 바꾸지 못한다.
추가로 `no`는 숫자여야 하므로 `ctype_digit()`으로 **타입 검증**까지 두면 더 좋다.

## 6. 정리

- 따옴표 없는 **숫자 컨텍스트**라도 인젝션은 성립한다 — 입력이 쿼리에 직접 들어가면 끝.
- `AND`가 `OR`보다 먼저 묶인다는 **연산자 우선순위**가 `0||no=2` 페이로드의 핵심이다.
- **블랙리스트 필터는 방어가 아니다** — 공백은 `||`로, 괄호는 다른 연산으로 우회된다.
- 올바른 해법은 **prepared statement + 타입 검증**. 입력을 구조가 아닌 데이터로 다뤄야 한다.

> 필터를 한 겹 더 쌓는 대신, "사용자 입력이 쿼리의 **구조**를 바꿀 수 있는가"를 먼저 묻는다.
