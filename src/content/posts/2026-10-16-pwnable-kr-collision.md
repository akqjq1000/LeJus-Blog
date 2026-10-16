---
title: "pwnable.kr [Toddler's Bottle] collision 풀이 — 포인터 캐스팅과 체크섬 충돌"
description: "pwnable.kr col 문제를 REA로 정적 분석하고, 20바이트 입력을 int 5개의 합으로 해석하는 체크섬을 역산해 원격에서 풀이한 기록. char* → int* 캐스팅의 함정을 정리한다."
date: 2026-10-16
category: Security
tags: [pwnable.kr, pwn, wargame, linux, reverse-engineering, c]
---

[pwnable.kr](https://pwnable.kr) **Toddler's Bottle** 두 번째 문제 `collision`(바이너리 이름 `col`).
"MD5 해시 충돌 같은 걸 해보고 싶다"는 설명이지만, 실제로는 MD5가 아니라
**아주 단순한 체크섬(int 5개의 합)을 목표값과 충돌시키는** 문제다.
[fd 풀이](/LeJus-Blog/posts/2026-10-16-pwnable-kr-fd/)와 마찬가지로 바이너리를 REA로 교차검증하고
원격에서 직접 풀었다.

![pwnable.kr collision 문제 페이지](/LeJus-Blog/images/col-challenge.jpg)

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 카테고리 | Toddler's Bottle |
| 배점 | 3 pt |
| 접속 | `socat STDIO,raw,echo=0,opost,onlcr TCP:pwnable.kr:10002` |
| 설명 | *Daddy told me about cool MD5 hash collision today. I wanna do something like that too!* |

## 2. 소스 코드

`collision.zip`의 `col.c`:

```c
#include <stdio.h>
#include <string.h>
unsigned long hashcode = 0x21DD09EC;
unsigned long check_password(const char* p){
	int* ip = (int*)p;
	int i;
	int res=0;
	for(i=0; i<5; i++){
		res += ip[i];
	}
	return res;
}

int main(int argc, char* argv[]){
	if(argc<2){ printf("usage : %s [passcode]\n", argv[0]); return 0; }
	if(strlen(argv[1]) != 20){ printf("passcode length should be 20 bytes\n"); return 0; }

	if(hashcode == check_password( argv[1] )){
		setregid(getegid(), getegid());
		system("/bin/cat flag");
		return 0;
	}
	else
		printf("wrong passcode.\n");
	return 0;
}
```

읽어야 할 조건은 둘이다.

1. `strlen(argv[1]) == 20` — 패스코드는 **정확히 20바이트**.
2. `check_password(argv[1]) == 0x21DD09EC`.

## 3. 핵심: `char*`를 `int*`로 캐스팅

`check_password`는 받은 `char* p`(20바이트)를 **`int* ip`로 캐스팅**한 뒤
`ip[0..4]`를 더한다. 즉 20바이트를 **4바이트 정수 5개**로 재해석해서 그 합을 구한다.

```c
int* ip = (int*)p;      // 20 bytes → int[5]
for(i=0;i<5;i++) res += ip[i];   // 5개 int의 합
```

x86은 **리틀 엔디언**이므로, 메모리의 첫 4바이트 `b0 b1 b2 b3` 은
정수 `0xb3b2b1b0` 으로 읽힌다. 이 점이 입력 바이트를 설계할 때 핵심이 된다.

## 4. REA로 정적 분석

REA(Hopper)로 `col`(`ELF 32-bit, PIE, not stripped`)을 분석했다.

**`check_password`** — 소스의 루프가 그대로 보인다.

```nasm
0x120a: mov dword [ebp+var_4], 0x0      ; i = 0
0x122b: cmp dword [ebp+var_4], 0x4      ; i <= 4 ?
0x1213: mov eax, dword [ebp+var_4]
0x1216: lea edx, dword [eax*4]          ; i*4
0x121d: mov eax, dword [ebp+var_C]      ; base pointer p
0x1220: add eax, edx                    ; p + i*4
0x1222: mov eax, dword [eax]            ; *(int*)(p + i*4)  ← 4바이트 로드
0x1224: add dword [ebp+var_8], eax      ; res += ...
0x1227: add dword [ebp+var_4], 0x1      ; i++
```

`mov eax, dword [eax]` 가 **4바이트 단위 로드**임을 확인할 수 있다 — 포인터 캐스팅이 바이트 접근이 아니라 int 접근으로 컴파일됐다는 증거다.

**`main`** — 길이 검사와 비교 지점이 명확하다.

```nasm
0x1289: call sub_1090        ; strlen(argv[1])
0x1291: cmp eax, 0x14        ; == 20 ?
0x1294: je  loc_12af
...
0x12bb: call check_password
0x12c3: mov edx, dword [ebx-0x3fc4+hashcode]  ; hashcode = 0x21DD09EC
0x12c9: cmp eax, edx
0x12cb: jne loc_12ff         ; 다르면 wrong passcode
; 같으면 setregid → system("/bin/cat flag")
```

- `cmp eax, 0x14` → 길이 20 확인.
- `hashcode` 심볼을 직접 로드해 `check_password` 결과와 `cmp`.
- **소스와 완전 일치.** 숨겨진 변형은 없다.

## 5. 패스코드 역산

목표: 서로 더해 `0x21DD09EC` 가 되는 int 5개.
가장 간단하게 **4개는 같은 값, 1개로 나머지를 보정**한다.

```
0x21DD09EC ÷ 5 = 0x06C5CEC8 … 나머지 4
→ int[0..3] = 0x06C5CEC8
→ int[4]    = 0x06C5CEC8 + 4 = 0x06C5CECC

검산: 0x06C5CEC8 × 4 + 0x06C5CECC = 0x21DD09EC  ✓
```

리틀 엔디언 바이트열(20바이트)로 변환:

```
0x06C5CEC8 → C8 CE C5 06
0x06C5CECC → CC CE C5 06

passcode = C8 CE C5 06  C8 CE C5 06  C8 CE C5 06  C8 CE C5 06  CC CE C5 06
```

- 널 바이트(`0x00`)가 없어 `strlen`이 중간에 끊기지 않는다 → 길이 20 보장.
- 공백/개행 바이트도 없어 셸 인자로 넘길 때 분리되지 않는다.

## 6. 원격 풀이

패스코드에 **출력 불가능한 바이너리 바이트**가 섞여 있으므로, 셸에서 직접 타이핑할 수 없다.
`python`으로 정확한 argv를 만들어 `col`을 실행했다. (바이트 전달 안정성을 위해 명령을 base64로 감싸 전송)

```python
# 원격에서 실행된 명령(복원)
python2 -c 'import os; os.execv("./col",
    ["col", "\xc8\xce\xc5\x06"*4 + "\xcc\xce\xc5\x06"])'
```

실행 결과:

```console
$ nc pwnable.kr 10002
=====================================================================================
  [ Collision Shell ]
=====================================================================================
col@...:/tmp/tmp.xxxx$ python2 -c 'import os;os.execv("./col",["col","\xc8..."])'
<플래그 출력 — 공개 글에서는 가림>
```

> 플래그는 정상 출력되어 문제를 해결했다. 다른 학습자를 위해 값은 가린다 —
> pwnable.kr의 **Submit flag** 에 직접 입력하면 점수가 올라간다.

## 7. 정리

- `collision`의 본질은 MD5가 아니라 **`char*`를 `int*`로 캐스팅해 만든 약한 체크섬**이다.
- 20바이트를 **리틀 엔디언 int 5개**로 보고, 합이 `0x21DD09EC`가 되도록 역산하면 된다.
- **널·공백 바이트를 피하는 것**이 길이 검사와 셸 인자 전달 양쪽에서 중요하다.
- REA 어셈블리에서 `mov eax,[eax]`(4바이트 로드)와 `cmp eax,0x14`로
  **포인터 캐스팅과 길이 조건을 바이너리 수준에서 확정**할 수 있었다.

> 다음은 `bof` — 스택 버퍼 오버플로우로 넘어간다.
