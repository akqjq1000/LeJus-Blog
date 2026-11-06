---
title: "웹 서버 통신의 전 과정 — TCP 핸드셰이크부터 TLS·HTTP·HTML까지 한 흐름으로"
description: "브라우저 주소창에 Enter를 누른 순간부터 화면에 HTML이 그려지기까지. TCP 3-way handshake, TLS/SSL과 HSTS, HTTP 요청·응답과 헤더, Method, stateless와 keep-alive, HTTP 버전, Apache와 Nginx를 실제 통신 로그와 함께 하나의 흐름으로 정리한다."
date: 2026-11-06
category: Web
tags: [web, http, https, tls, ssl, hsts, tcp, keep-alive, http2, http3, nginx, apache, network]
draft: false
---

주소창에 `https://akqjq1000.github.io/LeJus-Blog/`를 치고 Enter를 누르면,
화면에 글이 그려지기까지 **1초도 안 되는 사이**에 꽤 많은 일이 벌어진다.
TCP로 연결을 뚫고, TLS로 암호화를 협상하고, HTTP 요청을 보내고, 응답으로 받은 HTML을 브라우저가 그린다.

평소에는 블랙박스처럼 지나가는 이 과정을, `curl -v`로 실제 요청을 보내 **한 줄씩 눈으로 확인하며** 정리한다.
개별 키워드를 따로 외우는 대신, **요청 하나가 거치는 길**을 따라가면 HTTP·HTTPS·헤더·Method·keep-alive가 왜 그 자리에 있는지가 자연스럽게 보인다.

<figure style="margin:28px 0">
<svg viewBox="0 0 720 150" style="width:100%;height:auto" role="img" aria-label="웹 요청 전체 흐름: DNS, TCP 3-way handshake, TLS, HTTP 요청/응답, HTML 렌더링">
  <style>@keyframes wscf{from{opacity:0}to{opacity:1}} .wa{animation:wscf .55s ease both}</style>
  <defs>
    <marker id="fa" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="var(--muted)"/>
    </marker>
  </defs>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <g class="wa" style="animation-delay:0s">
      <rect x="8" y="40" width="96" height="46" rx="8" fill="var(--bg-soft)" stroke="var(--border)"/>
      <text x="56" y="60" fill="var(--text)">DNS 조회</text>
      <text x="56" y="76" fill="var(--muted)" font-size="10.5">이름 → IP</text>
    </g>
    <g class="wa" style="animation-delay:.12s">
      <rect x="128" y="40" width="112" height="46" rx="8" fill="var(--bg-soft)" stroke="var(--border)"/>
      <text x="184" y="60" fill="var(--text)">TCP 3-way</text>
      <text x="184" y="76" fill="var(--muted)" font-size="10.5">연결 수립</text>
    </g>
    <g class="wa" style="animation-delay:.24s">
      <rect x="264" y="40" width="112" height="46" rx="8" fill="var(--bg-soft)" stroke="var(--border)"/>
      <text x="320" y="60" fill="var(--accent)">TLS</text>
      <text x="320" y="76" fill="var(--muted)" font-size="10.5">암호화 협상</text>
    </g>
    <g class="wa" style="animation-delay:.36s">
      <rect x="400" y="40" width="132" height="46" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
      <text x="466" y="60" fill="var(--text)">HTTP 요청/응답</text>
      <text x="466" y="76" fill="var(--muted)" font-size="10.5">request / response</text>
    </g>
    <g class="wa" style="animation-delay:.48s">
      <rect x="556" y="40" width="112" height="46" rx="8" fill="var(--bg-soft)" stroke="var(--border)"/>
      <text x="612" y="60" fill="var(--text)">HTML 렌더</text>
      <text x="612" y="76" fill="var(--muted)" font-size="10.5">화면 표시</text>
    </g>
    <g class="wa" style="animation-delay:.3s" stroke="var(--muted)" stroke-width="1.4">
      <line x1="106" y1="63" x2="124" y2="63" marker-end="url(#fa)"/>
      <line x1="242" y1="63" x2="260" y2="63" marker-end="url(#fa)"/>
      <line x1="378" y1="63" x2="396" y2="63" marker-end="url(#fa)"/>
      <line x1="534" y1="63" x2="552" y2="63" marker-end="url(#fa)"/>
    </g>
    <text x="360" y="118" fill="var(--muted)" font-size="11">HTTPS = TCP 연결 위에 TLS 한 겹을 더 올린 뒤 그 안에서 HTTP를 주고받는 것</text>
  </g>
</svg>
<figcaption style="text-align:center;color:var(--muted);font-size:13px;margin-top:6px">요청 하나가 거치는 길 (직접 작성한 다이어그램)</figcaption>
</figure>

## 1. 먼저 길을 뚫는다 — TCP 3-way handshake

HTTP든 HTTPS든, 데이터를 주고받으려면 **먼저 클라이언트와 서버 사이에 TCP 연결**이 있어야 한다.
TCP는 "보낸 데이터가 순서대로, 빠짐없이 도착하는" 신뢰성 있는 연결을 보장하는데,
그 연결을 여는 절차가 **3-way handshake**다. 말 그대로 패킷을 세 번 주고받는다.

<figure style="margin:28px 0">
<svg viewBox="0 0 680 280" style="width:100%;height:auto" role="img" aria-label="TCP 3-way handshake: SYN, SYN+ACK, ACK">
  <style>@keyframes wscf{from{opacity:0}to{opacity:1}} .wa{animation:wscf .55s ease both}</style>
  <defs>
    <marker id="ha" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto">
      <path d="M0,0 L7,3.2 L0,6.4 Z" fill="var(--accent)"/>
    </marker>
  </defs>
  <g font-family="var(--font-mono)">
    <text x="130" y="28" text-anchor="middle" font-size="13" fill="var(--text)">Client</text>
    <text x="550" y="28" text-anchor="middle" font-size="13" fill="var(--text)">Server</text>
    <line x1="130" y1="40" x2="130" y2="250" stroke="var(--border)" stroke-width="1.5"/>
    <line x1="550" y1="40" x2="550" y2="250" stroke="var(--border)" stroke-width="1.5"/>
    <g class="wa" style="animation-delay:.15s">
      <line x1="130" y1="80" x2="548" y2="110" stroke="var(--accent)" stroke-width="1.6" marker-end="url(#ha)"/>
      <text x="135" y="74" font-size="12.5" fill="var(--text)">① SYN</text>
      <text x="135" y="92" font-size="10.5" fill="var(--muted)">"연결 열자" (seq=x)</text>
    </g>
    <g class="wa" style="animation-delay:.55s">
      <line x1="550" y1="140" x2="132" y2="170" stroke="var(--accent)" stroke-width="1.6" marker-end="url(#ha)"/>
      <text x="545" y="134" text-anchor="end" font-size="12.5" fill="var(--text)">② SYN + ACK</text>
      <text x="545" y="152" text-anchor="end" font-size="10.5" fill="var(--muted)">"좋아, 나도 열자" (seq=y, ack=x+1)</text>
    </g>
    <g class="wa" style="animation-delay:.95s">
      <line x1="130" y1="200" x2="548" y2="230" stroke="var(--accent)" stroke-width="1.6" marker-end="url(#ha)"/>
      <text x="135" y="194" font-size="12.5" fill="var(--text)">③ ACK</text>
      <text x="135" y="212" font-size="10.5" fill="var(--muted)">"확인" (ack=y+1) → 연결 수립</text>
    </g>
  </g>
</svg>
<figcaption style="text-align:center;color:var(--muted);font-size:13px;margin-top:6px">TCP 3-way handshake (직접 작성한 다이어그램)</figcaption>
</figure>

1. **SYN** — 클라이언트가 "연결을 열고 싶다"며 첫 패킷을 보낸다. 시작 순서 번호(`seq=x`)를 함께 알린다.
2. **SYN + ACK** — 서버가 "그러자"고 응답하면서(`seq=y`), 동시에 클라이언트의 요청을 받았다는 확인(`ack=x+1`)을 보낸다.
3. **ACK** — 클라이언트가 서버의 응답을 확인(`ack=y+1`)한다. 이 순간 **양방향 연결이 완성**된다.

세 번을 주고받는 이유는 **양쪽 모두 "내 송신과 상대 수신이 된다"는 것을 서로 확인**하기 위해서다.
한 번(SYN)만으로는 서버가 클라이언트의 존재를 알 뿐이고, 두 번(SYN+ACK)까지는 클라이언트만 양방향을 확신한다.
세 번째 ACK가 와야 서버도 양방향을 확신한다. 이 연결이 열린 다음에야 비로소 HTTP 요청 바이트를 흘려보낼 수 있다.

## 2. 그 위에 암호화 한 겹 — HTTPS (TLS/SSL)

HTTP는 **평문**이다. TCP 연결 위로 글자가 그대로 흐르기 때문에, 중간 경로의 누군가가 들여다보면 요청·응답이 다 보인다.
**HTTPS는 별도의 프로토콜이 아니라, TCP와 HTTP 사이에 TLS 계층을 끼워 넣은 것**이다.
(SSL은 TLS의 옛 이름이다. 지금 쓰이는 건 전부 TLS 1.2 / 1.3이고, SSL 3.0 이하는 취약해 폐기됐다. 습관적으로 "SSL"이라 부를 뿐이다.)

TCP 3-way handshake가 끝나면, 데이터를 보내기 전에 **TLS handshake**가 한 번 더 일어난다. 핵심만 추리면 이렇다.

- 클라이언트가 지원하는 TLS 버전·암호 스위트(cipher suite) 목록과, 함께 쓸 **애플리케이션 프로토콜 후보를 ALPN으로 제시**한다.
- 서버가 **인증서**를 제시한다. 클라이언트는 이 인증서가 신뢰할 수 있는 CA가 서명한 것인지, 도메인이 맞는지 검증한다.
- 양쪽이 키를 교환해 **세션 키**를 만든다. 이후 모든 HTTP 바이트는 이 키로 암호화된다.

ALPN(Application-Layer Protocol Negotiation)은 "이 TLS 연결 안에서 HTTP를 몇 버전으로 말할까"를 handshake 단계에서 미리 합의하는 장치다.
실제로 이 블로그에 요청을 보내면 ALPN 협상 과정이 로그에 찍힌다.

```console
$ curl -v https://akqjq1000.github.io/LeJus-Blog/
*   Trying 185.199.108.153:443...
* ALPN: curl offers http/1.1
* ALPN: server accepted http/1.1
* using HTTP/1.x
> GET /LeJus-Blog/ HTTP/1.1
> Host: akqjq1000.github.io
```

클라이언트(`curl`)가 `http/1.1`을 제시했고 서버가 그걸 받아들여, 이 연결은 **HTTP/1.1로 말하기로** 확정된 것이다.
클라이언트가 `h2`(HTTP/2)를 함께 제시했다면 서버 지원 여부에 따라 HTTP/2로 올라갈 수도 있다. 버전 협상이 바로 이 지점에서 일어난다.

## 3. HTTP로는 새지 않게 — HSTS

HTTPS를 붙여도 구멍이 하나 남는다. 사용자가 주소창에 `http://`로 시작하거나 그냥 도메인만 입력하면,
**첫 요청이 평문 HTTP로 나가는** 순간이 생긴다. 보통 서버는 이걸 `301`로 HTTPS에 돌려보낸다.

```http
$ curl -I http://akqjq1000.github.io/LeJus-Blog/
HTTP/1.1 301 Moved Permanently
Location: https://akqjq1000.github.io/LeJus-Blog/
Server: GitHub.com
```

문제는 이 **첫 평문 요청이 가로채기에 노출**된다는 점이다(공격자가 리다이렉트를 가로채 평문 연결로 묶어두는 SSL stripping).
**HSTS(HTTP Strict-Transport-Security)**는 이걸 막는다. 서버가 응답 헤더로

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

를 한 번 내려주면, 브라우저는 "이 도메인은 앞으로 `max-age`(초) 동안 **무조건 HTTPS로만** 접속하라"고 기억한다.
이후에는 사용자가 `http://`를 쳐도 브라우저가 네트워크로 나가기 **전에 내부적으로 HTTPS로 바꿔** 보낸다. 평문 요청 자체가 사라지는 것이다.
`includeSubDomains`는 하위 도메인까지, `preload`는 브라우저에 **미리 목록으로 내장**시켜 "첫 접속조차 평문이 없도록" 만든다.

실제로 `github.com`은 이 헤더를 내려준다.

```http
$ curl -I https://github.com
HTTP/1.1 200 OK
Strict-Transport-Security: max-age=31536000; includeSubdomains; preload
Server: github.com
```

## 4. 요청과 응답의 생김새

연결과 암호화가 끝나면 이제 본론, **HTTP 메시지**를 주고받는다. 요청(request)과 응답(response)은 구조가 거의 대칭이다.

<figure style="margin:28px 0">
<svg viewBox="0 0 700 290" style="width:100%;height:auto" role="img" aria-label="HTTP 요청과 응답 메시지 구조 비교">
  <style>@keyframes wscf{from{opacity:0}to{opacity:1}} .wa{animation:wscf .55s ease both}</style>
  <g font-family="var(--font-mono)" font-size="12">
    <g class="wa" style="animation-delay:0s">
      <rect x="8" y="30" width="320" height="238" rx="10" fill="var(--bg-soft)" stroke="var(--border)"/>
      <text x="24" y="20" font-size="12.5" fill="var(--accent)">Request</text>
      <rect x="24" y="46" width="288" height="34" rx="6" fill="var(--surface)" stroke="var(--accent)"/>
      <text x="36" y="62" fill="var(--text)">GET /LeJus-Blog/ HTTP/1.1</text>
      <text x="36" y="75" font-size="9.5" fill="var(--muted)">start line: Method · 경로 · 버전</text>
      <rect x="24" y="88" width="288" height="86" rx="6" fill="var(--surface)" stroke="var(--border)"/>
      <text x="36" y="106" fill="var(--text)">Host: akqjq1000.github.io</text>
      <text x="36" y="124" fill="var(--text)">User-Agent: curl/8.21.0</text>
      <text x="36" y="142" fill="var(--text)">Accept: */*</text>
      <text x="36" y="166" font-size="9.5" fill="var(--muted)">request headers</text>
      <line x1="24" y1="190" x2="312" y2="190" stroke="var(--muted)" stroke-dasharray="3 3"/>
      <text x="168" y="186" text-anchor="middle" font-size="9.5" fill="var(--muted)">빈 줄 (헤더 끝)</text>
      <rect x="24" y="200" width="288" height="52" rx="6" fill="var(--surface)" stroke="var(--border)" stroke-dasharray="4 3"/>
      <text x="168" y="230" text-anchor="middle" fill="var(--muted)">body (GET은 보통 없음)</text>
    </g>
    <g class="wa" style="animation-delay:.2s">
      <rect x="372" y="30" width="320" height="238" rx="10" fill="var(--bg-soft)" stroke="var(--border)"/>
      <text x="388" y="20" font-size="12.5" fill="var(--accent)">Response</text>
      <rect x="388" y="46" width="288" height="34" rx="6" fill="var(--surface)" stroke="var(--accent)"/>
      <text x="400" y="62" fill="var(--text)">HTTP/1.1 200 OK</text>
      <text x="400" y="75" font-size="9.5" fill="var(--muted)">status line: 버전 · 상태 코드</text>
      <rect x="388" y="88" width="288" height="86" rx="6" fill="var(--surface)" stroke="var(--border)"/>
      <text x="400" y="106" fill="var(--text)">Content-Type: text/html</text>
      <text x="400" y="124" fill="var(--text)">Content-Length: 19227</text>
      <text x="400" y="142" fill="var(--text)">Connection: keep-alive</text>
      <text x="400" y="166" font-size="9.5" fill="var(--muted)">response headers</text>
      <line x1="388" y1="190" x2="676" y2="190" stroke="var(--muted)" stroke-dasharray="3 3"/>
      <text x="532" y="186" text-anchor="middle" font-size="9.5" fill="var(--muted)">빈 줄 (헤더 끝)</text>
      <rect x="388" y="200" width="288" height="52" rx="6" fill="var(--surface)" stroke="var(--border)"/>
      <text x="532" y="230" text-anchor="middle" fill="var(--text)">body: &lt;!doctype html&gt; …</text>
    </g>
  </g>
</svg>
<figcaption style="text-align:center;color:var(--muted);font-size:13px;margin-top:6px">HTTP 요청·응답 메시지 구조 (직접 작성한 다이어그램)</figcaption>
</figure>

두 메시지 모두 **① 시작 줄 → ② 헤더들 → ③ 빈 줄 → ④ 본문(body)** 순서로 생겼다.

- **요청의 시작 줄**: `Method 경로 버전` — 예) `GET /LeJus-Blog/ HTTP/1.1`
- **응답의 시작 줄**: `버전 상태코드 사유` — 예) `HTTP/1.1 200 OK`
- **헤더가 끝나는 지점은 빈 줄 하나**(`\r\n\r\n`)로 표시된다. 그 뒤가 본문이다.

### request header — 클라이언트가 붙이는 메모

요청 헤더는 "나는 누구이고, 무엇을, 어떤 형태로 원하는가"를 서버에 알려준다. 자주 보는 것들:

| 헤더 | 역할 |
| --- | --- |
| `Host` | 어느 도메인에 대한 요청인지 (한 IP가 여러 사이트를 서빙하므로 필수) |
| `User-Agent` | 클라이언트 종류 (브라우저/버전, 또는 `curl`) |
| `Accept` | 원하는 응답 형식 (`text/html`, `application/json` …) |
| `Accept-Encoding` | 받을 수 있는 압축 방식 (`gzip`, `br` …) |
| `Cookie` | 이전에 서버가 심어 둔 상태값 (뒤의 stateful 참고) |
| `Authorization` | 인증 토큰/자격 증명 |

`Host`는 HTTP/1.1에서 **필수**다. 한 서버 IP가 여러 도메인을 호스팅하는 가상 호스팅 환경에서,
서버는 `Host` 헤더를 보고 어느 사이트의 어떤 파일을 줄지 결정한다.

### response header — 서버가 붙이는 메모

응답 헤더는 "돌려주는 게 무엇이고, 어떻게 다뤄야 하는가"를 설명한다. 이 블로그의 실제 응답을 보면:

```http
$ curl -I https://akqjq1000.github.io/LeJus-Blog/
HTTP/1.1 200 OK
Server: GitHub.com
Content-Type: text/html; charset=utf-8
Content-Length: 19227
Last-Modified: Thu, 05 Nov 2026 13:42:27 GMT
Cache-Control: max-age=600
ETag: "6aec87c3-4b1b"
Connection: keep-alive
```

| 헤더 | 역할 |
| --- | --- |
| `Content-Type` | 본문의 형식 — `text/html`이라 브라우저가 HTML로 해석해 렌더링한다 |
| `Content-Length` | 본문 바이트 크기 (여기선 19,227바이트) |
| `Cache-Control` / `ETag` | 캐시 정책 — `max-age=600`이면 10분간 재사용, `ETag`로 변경 여부 확인 |
| `Last-Modified` | 마지막 수정 시각 |
| `Connection: keep-alive` | 이 TCP 연결을 끊지 말고 재사용하자 (뒤의 keep-alive 참고) |

`Content-Type: text/html; charset=utf-8` — 이 한 줄 때문에 브라우저는 받은 본문을 **HTML 문서로 파싱**하고,
그 안의 `<link>`, `<script>`, `<img>`를 보고 추가 요청을 다시 보낸다. 같은 바이트라도 `Content-Type`이 `text/plain`이면 그냥 글자로 보여줄 뿐이다.

## 5. HTTP Method — 무엇을 하려는가

요청 시작 줄의 맨 앞 단어가 **Method**다. "이 리소스에 대해 무슨 동작을 원하는가"를 나타낸다.

| Method | 의미 | 본문 | 멱등성 |
| --- | --- | --- | --- |
| `GET` | 리소스 **조회** | 보통 없음 | ✓ |
| `POST` | 리소스 **생성**·데이터 제출 | 있음 | ✗ |
| `PUT` | 리소스 **전체 교체** | 있음 | ✓ |
| `PATCH` | 리소스 **일부 수정** | 있음 | ✗ |
| `DELETE` | 리소스 **삭제** | 보통 없음 | ✓ |
| `HEAD` | `GET`과 같지만 **헤더만** (본문 제외) | 없음 | ✓ |
| `OPTIONS` | 이 리소스가 **허용하는 Method 질의** | 없음 | ✓ |

> **멱등성(idempotent)**: 같은 요청을 여러 번 보내도 결과(서버 상태)가 같은 성질. `GET`을 열 번 해도 조회만 될 뿐이지만, `POST`를 열 번 하면 글이 열 개 생길 수 있다. 네트워크가 불안해 요청을 재시도할 때 안전한지를 가른다.

`OPTIONS`는 특히 CORS(교차 출처 요청)에서 **예비 요청(preflight)**으로 쓰인다.
브라우저가 본 요청 전에 "너 이 Method 받아주니?"를 먼저 물어보는 것이다. `api.github.com`에 실제로 던져 보면:

```http
$ curl -X OPTIONS -i https://api.github.com
HTTP/1.1 204 No Content
access-control-allow-methods: GET, POST, PATCH, PUT, DELETE
```

서버가 "GET·POST·PATCH·PUT·DELETE는 받아준다"고 `access-control-allow-methods`로 답한다.
`204 No Content`는 "성공했고, 돌려줄 본문은 없다"는 상태 코드다.

## 6. HTTP는 기억하지 않는다 — stateless, 그리고 stateful

HTTP의 기본 성격은 **stateless(무상태)**다. 요청 하나하나가 서로 독립적이고, **서버는 이전 요청을 기억하지 않는다.**
방금 로그인한 사람이든 처음 온 사람이든, 다음 요청만 놓고 보면 서버에겐 똑같은 낯선 요청이다.
이 단순함 덕분에 서버는 요청을 아무 순서로, 아무 서버 인스턴스에서나 처리할 수 있어 **확장(scaling)이 쉽다.**

그런데 로그인 상태나 장바구니처럼 **"기억해야 하는" 기능**은 어떻게 만들까.
상태를 요청마다 **클라이언트가 들고 다니게** 해서 stateless한 HTTP 위에 **stateful한 경험**을 얹는다. 대표가 쿠키/세션이다.

1. 로그인에 성공하면 서버가 응답에 **`Set-Cookie: session=abc123`**을 실어 보낸다.
2. 브라우저는 이 값을 저장했다가, 같은 사이트로 가는 **모든 요청에 `Cookie: session=abc123`**을 자동으로 붙인다.
3. 서버는 매 요청의 쿠키값으로 "아, 이 사람은 아까 로그인한 그 사람"이라고 **매번 다시 식별**한다.

```http
# 응답: 상태값을 클라이언트에 심는다
< Set-Cookie: session=abc123; HttpOnly; Secure; SameSite=Lax

# 이후 요청: 클라이언트가 그 값을 되돌려 준다
> Cookie: session=abc123
```

즉 **HTTP 프로토콜 자체는 여전히 stateless**이고, 상태는 쿠키라는 "매번 다시 제출하는 증표"로 흉내 낸다.
이 구조를 이해하면 세션 하이재킹(쿠키 탈취), `HttpOnly`/`Secure`/`SameSite` 같은 쿠키 보안 속성이 왜 중요한지도 바로 연결된다.

## 7. 연결을 아끼다 — keep-alive, 그리고 HTTP 버전의 진화

앞에서 본 TCP 3-way handshake(+TLS handshake)는 **연결을 열 때마다 드는 비용**이다.
웹 페이지 하나에는 HTML·CSS·JS·이미지 등 수십 개의 리소스가 딸려 있는데, 매번 연결을 새로 열고 닫으면 그 비용이 수십 배로 불어난다.

**keep-alive**는 "요청-응답이 끝나도 TCP 연결을 끊지 말고 **다음 요청에 재사용**하자"는 약속이다.
앞서 본 응답의 `Connection: keep-alive`가 바로 그 신호다. 한 번 뚫은 길로 여러 요청을 흘려보내 handshake 비용을 아낀다.

이 "연결을 어떻게 아끼고 병렬화하느냐"가 사실상 **HTTP 버전 진화의 줄거리**다.

| 버전 | 전송 기반 | 핵심 변화 |
| --- | --- | --- |
| **HTTP/1.0** | TCP | 요청마다 연결을 새로 열고 닫음 (keep-alive는 선택적 확장) |
| **HTTP/1.1** | TCP | **keep-alive 기본화**, 파이프라이닝. 단 한 연결에서 응답이 순서대로 나와 앞이 막히면 뒤가 밀리는 **HOL 블로킹** 존재 |
| **HTTP/2** | TCP | 한 연결 안에서 요청을 **멀티플렉싱**(동시 다중 스트림), 헤더 압축(HPACK). 애플리케이션 계층의 HOL은 해소 |
| **HTTP/3** | **QUIC (UDP)** | TCP를 버리고 UDP 기반 QUIC로. 연결 수립과 TLS를 **한 번에**, TCP 레벨 HOL 블로킹까지 제거 |

HTTP/1.1까지는 한 연결에서 한 번에 하나씩만 처리돼, 리소스가 많으면 브라우저가 연결을 여러 개 여는 식으로 우회했다.
HTTP/2는 **한 연결 안에서 여러 요청을 동시에** 실어 날라 이 문제를 크게 줄였다.
HTTP/3은 아예 전송 계층을 TCP에서 **UDP 기반 QUIC**로 바꿔, "연결이 하나라도 패킷 하나가 늦으면 전체가 멈추던" TCP의 한계까지 걷어냈다.

> 어떤 버전을 쓸지는 2절에서 본 **ALPN 협상**으로 정해진다. 위 curl 로그에서 `http/1.1`로 합의된 것처럼, 클라이언트와 서버가 공통으로 지원하는 가장 높은 버전으로 올라간다.

## 8. 그 요청을 받는 쪽 — Apache와 Nginx

지금까지의 요청을 서버에서 **실제로 받아 처리하는 소프트웨어**가 웹 서버다. 대표가 Apache HTTP Server와 Nginx다.
둘 다 HTTP 요청을 받아 정적 파일을 돌려주거나 뒤단 애플리케이션으로 넘기지만, **동시 연결을 다루는 방식**이 다르다.

| | Apache (prefork/worker) | Nginx |
| --- | --- | --- |
| 처리 모델 | 연결마다 **프로세스/스레드** 할당 | **이벤트 기반** 비동기 (적은 수의 워커가 많은 연결 처리) |
| 동시 연결 多 | 연결 수만큼 메모리↑ (C10K 문제에 취약) | 연결이 많아도 메모리 완만 |
| 강점 | `.htaccess`로 디렉터리별 유연한 설정, 풍부한 모듈 | 정적 파일·리버스 프록시·로드 밸런서로서 가볍고 빠름 |
| 흔한 조합 | 단독, 또는 애플리케이션 서버로 | 앞단 리버스 프록시 + 뒤에 Apache/앱 서버 |

전통적으로 Apache는 "연결 하나당 일꾼 하나"라서 동시 접속이 폭증하면 프로세스/메모리가 함께 폭증했다(이른바 **C10K 문제**).
Nginx는 **적은 수의 워커가 이벤트 루프로 수많은 연결을 번갈아 처리**하도록 설계돼, 같은 자원으로 훨씬 많은 동시 연결을 감당한다.
그래서 실무에서는 **Nginx를 앞단 리버스 프록시**로 두고 정적 파일·TLS 종료·로드 밸런싱을 맡기고, 동적 처리는 뒤단 앱 서버에 넘기는 구성이 흔하다.

참고로 이 블로그의 응답 헤더 `Server: GitHub.com`은 GitHub Pages가 자체 인프라(CDN 포함)로 서빙한다는 표시다. 꼭 Apache/Nginx 이름이 그대로 노출되는 건 아니다.

## 9. 돌아온 것은 결국 HTML

응답 본문으로 받은 `text/html` 문서를 브라우저가 파싱하면, 그 안의 `<link rel="stylesheet">`, `<script>`, `<img>` 같은 태그가
**또 다른 리소스를 가리킨다.** 브라우저는 이들을 위해 다시 HTTP 요청을 보낸다 — 이때 keep-alive로 열어 둔 연결(또는 HTTP/2의 다중 스트림)이 재사용된다.

즉 "페이지 하나를 연다"는 건 요청 하나가 아니라, **HTML을 받는 첫 요청을 기점으로 줄줄이 이어지는 요청들의 묶음**이다.
우리가 1~8절에서 따라온 과정(TCP → TLS → HTTP 요청/응답)이, 리소스 개수만큼 반복되거나 한 연결 위에서 병렬로 포개지는 것이다.

## 10. 정리 — 한 흐름으로 다시

주소창에 Enter를 누른 순간부터 화면에 글이 그려지기까지를, 지금까지의 조각으로 한 줄에 꿰면 이렇다.

1. **DNS**로 도메인을 IP로 바꾼다.
2. **TCP 3-way handshake**(SYN → SYN+ACK → ACK)로 연결을 뚫는다.
3. HTTPS면 그 위에서 **TLS handshake** — 인증서 검증, 세션 키 합의, **ALPN으로 HTTP 버전 협상**.
4. **HSTS**가 걸려 있으면 애초에 평문 HTTP는 나가지도 않는다.
5. **HTTP 요청**을 보낸다: `Method 경로 버전` + **request header** + (본문).
6. 서버(**Nginx/Apache** 등)가 처리해 **HTTP 응답**을 돌려준다: `버전 상태코드` + **response header** + **HTML 본문**.
7. HTTP는 **stateless**라 서버는 매번 낯설게 보지만, **쿠키**로 **stateful**한 로그인 상태를 흉내 낸다.
8. **keep-alive**로 연결을 재사용하고, **HTTP/2·3**는 한 연결에 요청을 포개 더 빠르게 나른다.
9. 받은 **HTML** 속 리소스를 위해 2~8을 다시 — 페이지 하나가 완성된다.

각 키워드를 따로 보면 추상적이지만, **요청 하나가 거치는 길** 위에 올려놓으면 전부 같은 여정의 단계들이다.
다음에 `curl -v`로 아무 사이트나 열어 보면, 위 줄거리가 로그에 그대로 찍히는 걸 확인할 수 있다.

> 네트워크 탭이나 `curl -v` 로그가 복잡해 보일 때는, "지금 이 줄은 **연결(TCP)·암호화(TLS)·대화(HTTP)** 중 어느 단계인가"만 물으면 대부분 제자리를 찾는다.
