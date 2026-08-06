# 계단밑딴따라 음악 플레이어

밴드 연습용 음악 재생 플레이어 초안입니다. Supabase Storage에 올린 음원, 악보, 사진 URL을 `src/data/songs.js`에 넣어 사용하는 정적 웹앱 구조입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:5173/`로 접속합니다.

## 빌드

```bash
npm run build
```

빌드 결과물은 `dist/` 폴더에 생성됩니다.

## 곡 데이터 수정

곡 목록은 `src/data/songs.js`에서 관리합니다.

- `audioUrl`: 일반 재생용 전체 음원
- `splitTracks`: 분할 재생용 6개 악기 음원
- `scores`: 다운로드할 악보 파일
- `album.images`: 앨범 사진
- `album.youtubeId`: 유튜브 영상 ID

Supabase Storage 파일이 public bucket에 있으면 해당 공개 URL을 그대로 넣으면 됩니다.

## Supabase 업로드 설정

업로드 탭에서 PC 파일을 드래그앤드롭으로 올릴 수 있습니다. 실제 업로드를 쓰려면 `.env.example`을 참고해서 `.env.local`을 만들고 값을 넣습니다.

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_AUDIO_BUCKET=audio
VITE_SUPABASE_SPLIT_BUCKET=audio
VITE_SUPABASE_SCORE_BUCKET=scores
VITE_SUPABASE_ALBUM_BUCKET=album
```

Supabase Storage 버킷에는 브라우저 업로드를 허용하는 정책이 필요합니다. 공개 재생을 하려면 파일을 public bucket에 두거나, 나중에 signed URL 방식으로 바꾸면 됩니다.

업로드 경로는 대략 아래처럼 저장됩니다.

- 전체 음원: `곡폴더/full/파일명`
- 분할 음원: `곡폴더/악기/파일명`
- 악보: `곡폴더/파일명`
- 앨범 사진: `곡폴더/파일명`

## GitHub Pages 배포 메모

정적 웹앱이라 GitHub Pages로 배포할 수 있습니다. 저장소에 올린 뒤 GitHub Actions 또는 `dist/` 배포 방식을 선택하면 됩니다. 저장소명이 루트 도메인이 아닌 경우 Vite의 `base` 설정이 필요할 수 있습니다.
