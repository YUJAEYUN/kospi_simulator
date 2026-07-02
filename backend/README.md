# 백엔드 (실시간 시세 폴링 서버)

Vercel Functions는 고정 아웃바운드 IP가 없어서 토스 API의 허용 IP 목록에
등록할 수가 없습니다. 이 폴더는 그 문제를 해결하기 위한, 고정 IP를 가진
VM(네이버클라우드 등)에서 상시로 돌리는 별도의 작은 서버입니다.

- 3초(정확히는 `POLL_INTERVAL_MS`, 기본 2.5초)마다 토스 API를 직접 폴링해서
  현재가를 메모리에 들고 있습니다.
- `GET /snapshot`으로 지금까지 폴링한 값으로 계산한 코스피 지수 스냅샷을
  돌려줍니다. Next.js(Vercel) 앱은 토스를 직접 호출하지 않고 이 엔드포인트만
  호출합니다.
- 의존성이 전혀 없습니다 (Node 내장 `fetch`/`http`만 사용) — VM에 Node만
  설치되어 있으면 빌드 없이 바로 실행됩니다.

## 1. 준비물

- 고정 공인 IP를 가진 VM (네이버클라우드 서버, Oracle Cloud Always Free 등)
- Node.js 20.6 이상
- 토스 개발자센터에서 발급받은 `TOSS_CLIENT_ID` / `TOSS_CLIENT_SECRET`

## 2. 배포

```bash
# 이 backend/ 폴더만 VM으로 복사 (scp, git clone 등 편한 방법으로)
cp .env.example .env
nano .env   # TOSS_CLIENT_ID, TOSS_CLIENT_SECRET, BACKEND_SECRET 채우기

npm start   # = node --env-file=.env src/server.js
```

`data/kospiConstituents.json`은 저장소의 것과 동일한 파일이어야 합니다.
루트 프로젝트에서 `npm run seed:kospi`나 `npm run recalibrate`를 다시
실행했다면, 이 폴더의 `data/kospiConstituents.json`도 최신 파일로 다시
복사해주세요.

## 3. 계속 살아있게 하기 (systemd 예시)

터미널을 닫아도 서버가 계속 떠 있어야 하므로, `systemd` 서비스로 등록하는 걸
권장합니다.

```ini
# /etc/systemd/system/kospi-backend.service
[Unit]
Description=KOSPI simulator backend
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/kospi-backend
ExecStart=/usr/bin/node --env-file=.env src/server.js
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kospi-backend
sudo systemctl status kospi-backend
```

## 4. 네트워크 설정 (놓치기 쉬운 부분)

포트(`PORT`, 기본 4000)를 **VM의 OS 방화벽과, 클라우드 콘솔의 네트워크
방화벽 양쪽 다** 열어야 합니다. 하나만 열면 계속 연결이 안 됩니다.

- 네이버클라우드: 서버 인스턴스의 **ACG(Access Control Group)**에 인바운드
  규칙으로 TCP `4000`(또는 쓰는 포트) 허용 추가. 소스는 가능하면 Vercel
  IP 대역으로 좁히기보다(Vercel도 고정 IP가 아니라 의미 없음), `BACKEND_SECRET`
  인증에 의존하고 포트만 열어두는 방식이 됩니다.
- OS 방화벽(ufw 등): `sudo ufw allow 4000/tcp`

## 5. 확인

```bash
curl http://<VM_공인IP>:4000/health
curl -H "Authorization: Bearer <BACKEND_SECRET>" http://<VM_공인IP>:4000/snapshot
```

`/health`가 `"ok": true`를 반환하면 폴링이 정상 동작 중인 것입니다.

## 6. Vercel 쪽 설정

Vercel 프로젝트 환경변수에 다음을 등록하세요 (더 이상 `TOSS_CLIENT_ID` /
`TOSS_CLIENT_SECRET`은 Vercel에 필요 없습니다 — 이 백엔드에만 있으면 됩니다):

```bash
BACKEND_URL=http://<VM_공인IP>:4000
BACKEND_SECRET=<위에서 설정한 것과 동일한 값>
```

## 7. 보안 관련

- `BACKEND_SECRET`은 최소 32바이트 이상 무작위 값으로 만드세요 (`openssl rand -hex 32`).
- HTTPS는 필수는 아닙니다 — 브라우저가 이 서버에 직접 요청하지 않고 항상
  Vercel 함수를 거치기 때문에, mixed-content 정책이 적용되지 않습니다.
  다만 여유가 되면 Let's Encrypt(Certbot)로 붙여서 `BACKEND_SECRET`이
  평문으로 오가지 않게 하는 걸 권장합니다.
