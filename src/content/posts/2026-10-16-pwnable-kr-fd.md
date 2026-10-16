---
title: "pwnable.kr [Toddler's Bottle] fd 풀이 — 파일 디스크립터와 REA 정적 분석"
description: "pwnable.kr의 첫 문제 fd를, 바이너리를 REA로 정적 분석해 읽어내고 원격 서비스에서 직접 풀이한 기록. 리눅스 파일 디스크립터 개념까지 정리한다."
date: 2026-10-16
category: Security
tags: [pwnable.kr, pwn, wargame, linux, file-descriptor, reverse-engineering]
---

[pwnable.kr](https://pwnable.kr)의 **Toddler's Bottle** 카테고리 첫 문제 `fd`를 풀었다.
이름 그대로 **리눅스 파일 디스크립터(file descriptor)** 를 이해하면 끝나는 입문 문제지만,
"아는 답을 입력"하는 데서 그치지 않고 **바이너리를 직접 정적 분석(REA)** 해서
코드가 실제로 그렇게 동작하는지 확인하는 과정을 기록으로 남긴다.

![pwnable.kr fd 문제 페이지](/LeJus-Blog/images/fd-challenge.jpg)

## 1. 문제 개요

| 항목 | 값 |
| --- | --- |
| 카테고리 | Toddler's Bottle |
| 배점 | 1 pt |
| 접속 | `socat STDIO,raw,echo=0,opost,onlcr TCP:pwnable.kr:10001` |
| 설명 | *Mommy! what is a file descriptor in Linux?* |

예전 pwnable.kr은 `ssh fd@pwnable.kr -p2222` 로 접속했지만,
현재는 **포트 10001의 `socat` 소켓 서비스**로 바뀌었다.
접속하면 컨테이너 안에서 500초 동안 쓸 수 있는 `/bin/bash` 셸이 주어지고,
그 안에서 setgid 바이너리 `fd`를 실행해 플래그를 읽는 구조다.

## 2. 소스 코드

문제 페이지의 **Download files**로 받은 `fd.zip` 안에 `fd.c`가 들어 있다.

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
char buf[32];
int main(int argc, char* argv[], char* envp[]){
	if(argc<2){
		printf("pass argv[1] a number\n");
		return 0;
	}
	int fd = atoi( argv[1] ) - 0x1234;
	int len = 0;
	len = read(fd, buf, 32);
	if(!strcmp("LETMEWIN\n", buf)){
		printf("good job :)\n");
		setregid(getegid(), getegid());
		system("/bin/cat flag");
		exit(0);
	}
	printf("learn about Linux file IO\n");
	return 0;
}
```

핵심은 세 줄이다.

```c
int fd = atoi( argv[1] ) - 0x1234;   // 내가 넘긴 숫자에서 0x1234를 뺀 값을 fd 번호로 사용
read(fd, buf, 32);                   // 그 fd에서 32바이트를 읽어 buf에 저장
strcmp("LETMEWIN\n", buf)            // buf가 정확히 "LETMEWIN\n" 이면 통과
```

## 3. REA로 바이너리 정적 분석

소스가 공개돼 있어도, **컴파일된 바이너리가 정말 소스대로 동작하는지**는
직접 디스어셈블해서 확인하는 습관이 중요하다. 여기서는 REA(Hopper 백엔드)로
`fd` 바이너리(`ELF 32-bit, PIE, not stripped`)의 `main`을 분석했다.

실제로 뽑아낸 어셈블리에서 로직이 그대로 보인다.

```nasm
; argc 검사: cmp dword [eax], 0x1 ; jg ...  →  argc < 2 면 안내문 출력 후 종료
0x122d: cmp dword [eax], 0x1
0x1230: jg  loc_124e

; fd = atoi(argv[1]) - 0x1234
0x125a: call sub_10c0        ; atoi(argv[1])
0x1262: sub  eax, 0x1234     ; - 0x1234
0x1267: mov  dword [ebp-0x1c], eax   ; fd 저장

; read(fd, buf, 32)
0x1274: push 0x20            ; len = 32
0x127c: push eax             ; &buf
0x127d: push dword [ebp-0x1c]; fd
0x1280: call sub_1060        ; read

; strcmp("LETMEWIN\n", buf)
0x1294: push eax             ; &buf
0x129b: push eax             ; "LETMEWIN\n"
0x129c: call sub_1040        ; strcmp
0x12a4: test eax, eax
0x12a6: jne  loc_12ef        ; 다르면 실패 분기로

; 통과 분기: setregid → system("/bin/cat flag") → exit(0)
0x12cb: call sub_10b0        ; setregid(getegid(), getegid())
0x12dd: call sub_1090        ; system("/bin/cat flag")
0x12ea: call sub_10a0        ; exit(0)
```

- `0x1262: sub eax, 0x1234` — 상수 `0x1234`가 그대로 보인다.
- 문자열 참조 `aLetmewinn`("LETMEWIN\n"), `aBincatFlag`("/bin/cat flag")도 그대로 확인된다.
- `strcmp` 결과가 0(일치)일 때만 `jne`를 타지 않고 플래그 출력 분기로 들어간다.

**정적 분석 결론 = 소스와 완전히 일치.** 조작이나 숨겨진 분기는 없다.

## 4. 파일 디스크립터 개념

리눅스에서 프로세스가 연 모든 파일/소켓/파이프는 **0 이상의 정수(파일 디스크립터)** 로 식별된다.
그중 표준 스트림 3개는 번호가 고정돼 있다.

| fd | 이름 | 기본 연결 |
| --- | --- | --- |
| `0` | stdin | 키보드 입력 |
| `1` | stdout | 화면 출력 |
| `2` | stderr | 에러 출력 |

이 문제의 `read(fd, buf, 32)`가 **stdin(fd 0)** 에서 읽게 만들면,
내가 터미널에 친 글자가 그대로 `buf`로 들어간다.

## 5. 풀이

프로그램은 `fd = atoi(argv[1]) - 0x1234` 를 쓴다. `fd`를 0으로 만들려면:

```
atoi(argv[1]) - 0x1234 = 0
atoi(argv[1])          = 0x1234
0x1234 (16진수)        = 4660 (10진수)
```

즉 **`argv[1]`에 `4660`** 을 주면 `read`가 stdin에서 읽고,
거기에 **`LETMEWIN`** 을 입력하면 `strcmp("LETMEWIN\n", buf)`가 0이 되어 플래그가 출력된다.
(`echo`/엔터가 붙여주는 개행 `\n`까지 포함해 정확히 `"LETMEWIN\n"` 이 된다.)

원격 서비스에 접속해 실행한 결과:

```console
$ nc pwnable.kr 10001
=================================================================================
  [ FD Shell ]
  Mommy! what is a file descriptor in Linux?
=================================================================================
fd@...:/tmp/tmp.xxxx$ ./fd 4660
LETMEWIN
good job :)
<플래그는 가림 — 진행 중인 워게임 예의상 공개하지 않음>
```

> 플래그는 실제로 정상 출력돼 문제를 해결했지만, 다른 학습자의 풀이 경험을 위해
> 공개 글에서는 값을 가린다. pwnable.kr 사이트에 직접 제출하면 점수가 올라간다.

## 6. 원격 인프라는 어떻게 구성돼 있나

`fd.zip`에는 바이너리·소스뿐 아니라 서버 구동 스크립트도 들어 있어서,
출제 측이 어떻게 안전하게 setgid 권한을 분리하는지 엿볼 수 있었다.

- **`super.pl`** — 10001 포트를 리스닝하다가 접속마다 `fork` 후
  `socat ... EXEC:/usr/bin/unshare -m /loader.sh` 를 실행해 **마운트 네임스페이스로 격리된 셸**을 띄운다.
- **`loader.sh`** — `mktemp`로 만든 tmpfs 디렉터리에 `fd`, `fd.c`, `flag`를 복사하고
  `chmod 2755 fd` 로 **setgid 비트**를 세운다. 플래그는 `chmod 440`, 그룹 `fd_pwn` 소유라
  일반 사용자 `fd`로는 직접 못 읽는다.
- 그래서 `fd` 바이너리가 `setregid(getegid(), getegid())` 로 **egid=`fd_pwn`** 를 유지한 채
  `system("/bin/cat flag")` 를 호출해야 비로소 플래그를 읽을 수 있다.

즉 "`LETMEWIN`만 맞히면 끝"처럼 보여도, 뒤에서는 **권한 분리 + setgid 바이너리**라는
전형적인 wargame 권한 모델이 깔려 있다.

## 7. 정리

- `fd` 문제의 본질은 **프로그램이 어느 파일 디스크립터에서 읽는지 제어하는 것**이다.
- `atoi(argv[1]) - 0x1234 = 0` → `argv[1] = 4660` 으로 **stdin(fd 0)** 을 가리키게 만든다.
- 소스가 있어도 **디스어셈블로 교차 검증**하면 바이너리를 읽는 눈이 길러진다.
- 운영 측 스크립트까지 보면 **setgid 기반 권한 분리**라는 실제 서버 보안 모델도 함께 배운다.

> 다음 문제는 `collision` 또는 `bof`. 계속 기록으로 남길 예정이다.
