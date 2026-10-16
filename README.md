# LeJus Blog

정보보안 · IT 기술을 직접 실험하고 기록하는 블로그.
**https://akqjq1000.github.io/LeJus-Blog/**

- Framework: [Astro](https://astro.build) (정적 사이트)
- Hosting: GitHub Pages (GitHub Actions 자동 배포)

## 로컬 개발

```bash
npm install
npm run dev        # http://localhost:4321/LeJus-Blog/
npm run build      # 타입 체크 + dist/ 생성
npm run preview    # 빌드 결과 미리보기
```

## 글 쓰기

```bash
npm run new -- "포스트 제목"
```

`src/content/posts/YYYY-MM-DD-포스트-제목.md` 가 `draft: true` 상태로 생성됩니다.
작성을 마치면 `draft: false`로 바꾸고 `main`에 push 하면 자동 배포됩니다.

### Frontmatter

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `title` | ✓ | 제목 |
| `description` | ✓ | 목록·SEO용 요약 |
| `date` | ✓ | 작성일 (`YYYY-MM-DD`) |
| `updated` | | 수정일 |
| `category` | | `Security` `Network` `Reversing` `Web` `System` `Dev` `Note` 중 하나 |
| `tags` | | 문자열 배열 |
| `draft` | | `true`면 배포되지 않음 (dev 서버에서는 보임) |

## 배포 파이프라인

`.github/workflows/deploy.yml`

1. `main` push / PR → `npm ci` → `astro check` + `astro build`
2. `main` push일 때만 `dist/`를 GitHub Pages에 배포
3. PR에서는 빌드 검증만 수행

> 최초 1회: GitHub 저장소 **Settings → Pages → Source** 를 **GitHub Actions** 로 설정해야 합니다.

## 구조

```
src/
  content/posts/     # 글 (Markdown)
  content.config.ts  # frontmatter 스키마
  layouts/ components/ pages/ styles/
public/              # 정적 파일 (favicon 등)
```
