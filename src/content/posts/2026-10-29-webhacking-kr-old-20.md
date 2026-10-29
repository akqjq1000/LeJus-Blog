---
title: "webhacking.kr old-20 풀이 — 2초 제한 폼과 DOM에 노출된 캡차 우회"
description: "webhacking.kr old-20을 통해 '2초 안에 제출'이라는 시간 제한과 페이지에 그대로 박혀 있는 캡차가 왜 자동화 앞에서 무력한지, fetch→POST 한 번으로 조건을 어떻게 만족시키는지를 직접 풀어 정리한다."
date: 2026-10-29
category: Web
tags: [webhacking.kr, web, wargame, automation, captcha, client-side]
---

[webhacking.kr](https://webhacking.kr)의 **old-20** 문제를 풀었다.
SQL 인젝션이나 필터 우회가 아니라, **"2초 안에 폼을 제출하라"는 시간 제한**과
**화면에 그대로 노출된 캡차** 가 사람을 거르려는 장치인데,
**스크립트 앞에서는 둘 다 장벽이 되지 못한다** 는 것을 보여주는 문제다.

"사람 손으로 2초 안에 입력하기"에서 멈추지 않고, **서버가 무엇을 검사하는지**
를 응답 메시지로 하나씩 확인하며 왜 `fetch` → `POST` 한 번이면 끝나는지 정리한다.
아래 내용은 전부 **실제로 서버에 넣어 통과를 확인한 것**이다.

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 사이트 | webhacking.kr (old) |
| 문제 | old-20 (`/challenge/code-4/`) |
| 유형 | 자동화 방지(시간 제한·캡차) 우회 |
| 목표 | `nickname`·`comment`·`captcha`를 채워 **2초 안에** 제출 |

문제 페이지는 맨 위에 `time limit : 2 second`를 띄우고,
`nickname`·`comment`·`captcha` 세 입력과 캡차 값이 적힌 버튼을 보여준다.
제한 시간을 넘기면 **`Too Slow...`**, 캡차가 틀리면 **`Wrong Captcha`** 가 뜬다.

## 2. 정보 수집 — 소스 코드

페이지 소스는 전부 클라이언트에 드러나 있다. 핵심만 옮기면 다음과 같다.

```html
<center><font size="2">time limit : 2 second</font></center>
<form name="lv5frm" method="post">
  <tr><td>nickname</td><td><input type="text" name="id" maxlength="10"></td></tr>
  <tr><td>comment</td> <td><input type="text" name="cmt" maxlength="50"></td></tr>
  <tr><td>captcha</td> <td>
    <input type="text" name="captcha">
    <input type="button" name="captcha_" value="Jxa9TXmfy4" style="...">
  </td></tr>
  <tr><td><input type="button" value="Submit" onclick="ck()"></td></tr>
</form>
<script>
function ck(){
  if(lv5frm.id.value=="")      { lv5frm.id.focus(); return; }
  if(lv5frm.cmt.value=="")     { lv5frm.cmt.focus(); return; }
  if(lv5frm.captcha.value=="") { lv5frm.captcha.focus(); return; }
  if(lv5frm.captcha.value != lv5frm.captcha_.value) { lv5frm.captcha.focus(); return; }
  lv5frm.submit();
}
</script>
```

읽어낼 수 있는 사실은 세 가지다.

1. 폼은 **자기 자신으로 POST**(`method="post"`, action 없음)하며 보내는 값은 `id`·`cmt`·`captcha`뿐이다.
2. **캡차의 정답(`captcha_` 버튼의 `value`)이 페이지에 그대로 적혀 있다.**
   사용자는 그걸 "보고 따라 입력"하면 되는데, 그 말은 **값이 이미 DOM 안에 있다**는 뜻이다.
3. `ck()`의 검사(빈 값·캡차 일치)는 전부 **클라이언트 측 자바스크립트**다 — 우회하려면 그냥 안 거치면 된다.

여기서 보이지 않는 부분은 서버다. 서버는 (a) 캡차가 맞는지, (b) **페이지를 받은 뒤 2초 안에 제출했는지** 를 검사한다.
이 두 가지는 응답 메시지로 직접 확인한다(§4).

> 캡차 값은 **페이지를 새로 받을 때마다 바뀐다.** 직접 세 번 GET 해보니
> `0RER6Dwwez` → `Jxa9TXmfy4` → `iJu8HQ7JT6` 로 매번 달랐다.
> 즉 서버가 이번 페이지 로드에 대해 정한 값을 세션에 저장해 두고 대조한다.

## 3. 문제점 — 어디가 취약한가

### 3-1. 사람을 거르려는 장치가 전부 "클라이언트에 노출"돼 있다

캡차의 목적은 **자동화된 요청을 거르는 것**이다. 그런데 이 문제의 캡차는
**정답을 같은 페이지 안에 적어서 내려준다.** 사람에게는 "눈으로 보고 입력"이지만,
스크립트에게는 **HTML에서 한 줄 뽑아내는 일**일 뿐이다.
이미지로 왜곡하거나, 서버만 아는 값으로 두는 게 아니라 **텍스트로 노출**했기 때문에
봇 차단 효과가 **0**이다.

### 3-2. "2초 제한"은 사람을 겨냥하지만 스크립트에겐 여유다

`time limit : 2 second`는 사람이 **닉네임·댓글·캡차를 손으로 다 치기엔 빠듯한** 시간을 노린 것이다.
하지만 스크립트는 **페이지를 받는 즉시 캡차를 파싱해 곧장 POST** 할 수 있다.
직접 재보니 GET→파싱→POST 왕복이 **0.6초 남짓**이라 2초 안에 넉넉히 들어간다.
**시간 제한은 "느린 입력 수단(사람)"만 막고, 빠른 입력 수단(코드)은 그대로 통과** 한다.

### 3-3. 클라이언트 검증(`ck()`)은 검증이 아니다

빈 값·캡차 일치를 보는 `ck()`는 **제출 버튼을 눌렀을 때만** 도는 자바스크립트다.
폼을 직접 POST하면 `ck()`는 아예 실행되지 않는다. 실제 방어는 서버 검사뿐인데,
그 서버 검사조차 **노출된 캡차 + 넉넉한 시간** 이라 막질 못한다.

## 4. 익스플로잇 — 페이로드 설계와 단계별 검증

필요한 건 단순하다. **이번 페이지의 캡차 값을 읽어, `id`·`cmt`와 함께 2초 안에 POST** 한다.
브라우저에서 수동으로 하면 페이지를 열고 읽는 사이 2초가 지나버리므로,
**GET과 POST를 한 흐름으로 묶어** 왕복 시간을 최소화하는 게 핵심이다.

서버가 무엇을 검사하는지 **실패 메시지로 먼저 확인** 했다.

**(1) 늦게 제출 → `Too Slow...`**
페이지를 먼저 열어 소스를 읽은 뒤, 시간이 지나고 나서 제출했더니 제한에 걸렸다.

```text
POST /challenge/code-4/   (페이지 로드 후 2초 경과)
→ Too Slow...
```

**(2) 캡차 불일치 → `Wrong Captcha`**
캡차 파싱이 빗나가 빈 값을 보냈더니 시간과 무관하게 캡차에서 걸렸다.
(소스의 속성이 `value="..."`는 따옴표가 있지만 `name=captcha_`는 따옴표가 없어, 파싱 정규식을 거기에 맞춰야 했다.)

```text
POST /challenge/code-4/   (captcha 값이 틀림/빔)
→ Wrong Captcha
```

**(3) 캡차 일치 + 2초 이내 → 통과**
GET으로 받은 HTML에서 `name=captcha_ value="(...)"` 를 뽑아 그대로 POST했다.

```js
const url = 'https://webhacking.kr/challenge/code-4/';
// 1) 페이지를 받아 이번 캡차 값을 읽는다
const page = await fetch(url, {credentials:'include'}).then(r => r.text());
const cap  = page.match(/name=captcha_ value="([^"]+)"/)[1];
// 2) 곧바로 같은 URL로 POST (id, cmt, captcha)
const body = new URLSearchParams({id:'lejus', cmt:'auto', captcha:cap});
const res  = await fetch(url, {
  method:'POST', credentials:'include',
  headers:{'Content-Type':'application/x-www-form-urlencoded'}, body
});
```

GET→파싱→POST 전체가 약 **0.6초**로, 2초 제한 안에 들어갔다.

```console
POST /challenge/code-4/   (captcha=iJu8HQ7JT6, elapsed ≈ 599ms)
→ old-20 Pwned. You got 20point. Congratz!
```

## 5. 결과

세 입력을 채우고 이번 캡차를 2초 안에 제출하자 서버가 바로 통과 처리했다.

```
old-20 Pwned. You got 20point. Congratz!
```

문제 목록에서도 **`✔️ old-20`** 으로 풀린 것을 확인했다.

> 이 문제도 **따로 제출할 플래그가 없다.** 조건(캡차 일치 + 2초 이내)을 만족하는
> 요청을 보내는 순간 서버가 `solve(20)`을 호출해 바로 통과시킨다.
> 즉 "비밀 값을 알아내는" 문제가 아니라 **의도된 요청을 빠르게 만들어 보내는** 문제다.

## 6. 왜 취약한가 — 그리고 올바른 방어

이 문제의 본질은 **"사람이라는 전제"로 자동화를 막으려 한 것**이다.
그 전제가 깨지는 지점이 세 곳이다.

**(1) 캡차 정답을 클라이언트에 노출했다.**
캡차는 "서버만 아는 답을, 기계가 알아보기 어렵게" 제시해야 의미가 있다.
정답을 텍스트로 같은 페이지에 실어 보내면 스크립트가 한 줄로 긁어간다.

```text
나쁨: <input name=captcha_ value="iJu8HQ7JT6">   // 정답이 DOM에 그대로
좋음: 서버가 세션에만 정답을 저장하고, 화면엔 왜곡 이미지/별도 수단으로만 제시
```

**(2) "시간 제한"을 봇 차단으로 착각했다.**
짧은 제한 시간은 사람의 입력 속도만 제약한다. 자동화는 왕복이 밀리초 단위라
오히려 더 쉽게 통과한다. 자동화를 막고 싶다면 **속도 제한(rate limit)·정상 캡차·
토큰(1회용 nonce)** 같은, "빠른 반복 자체"를 겨냥한 방어가 필요하다.

**(3) 검증을 클라이언트에 뒀다.**
`ck()`의 빈 값·캡차 일치 검사는 폼을 직접 POST하면 통째로 생략된다.
모든 검증은 **서버에서, 신뢰할 수 없는 입력을 전제로** 다시 해야 한다.

## 7. 정리

- **캡차는 정답을 클라이언트에 노출하는 순간 봇 차단 효과가 사라진다** — 이 문제는 캡차 값을 DOM에 그대로 박아 둬서 `fetch`로 긁어내면 끝이다.
- **짧은 시간 제한은 사람만 거른다** — GET→파싱→POST 왕복이 0.6초면 2초 제한은 장벽이 아니다.
- **클라이언트 측 검증(`ck()`)은 폼을 직접 POST하면 통째로 우회** 된다 — 검증은 서버에서 해야 한다.
- 자동화를 정말 막으려면 "사람은 느리다"는 전제가 아니라, **서버만 아는 값·속도 제한·1회용 토큰** 처럼 **반복 요청 자체를 겨냥한 방어** 가 필요하다.

> "사람이 2초 안에 못 한다"가 아니라, "자동화된 요청이 이 조건을 쉽게 만들 수 있는가"를 먼저 묻는다.
