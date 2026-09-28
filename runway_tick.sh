#!/usr/bin/env bash
# 매일 09시(한국 시간)에 비공개 런웨이 저장소의 알림 점검을 한 번 켬 (하루 1회)
[ -z "$RUNWAY_DISPATCH_TOKEN" ] && { echo "runway: dispatch token missing"; exit 0; }
H=$(TZ=Asia/Seoul date +%H); D=$(TZ=Asia/Seoul date +%F)
MARK="/tmp/runway_dispatch_test_$D"
if [ "$H" = "12" ] && [ ! -f "$MARK" ]; then
  code=$(curl -s -o /tmp/runway_dispatch_resp -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $RUNWAY_DISPATCH_TOKEN" -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/jtl10231-oss/runway-data/actions/workflows/check.yml/dispatches \
    -d '{"ref":"main","inputs":{"mode":"daily"}}')
  if [ "$code" = "204" ]; then
    touch "$MARK"; echo "runway daily check started"
  else
    echo "runway daily check start failed: HTTP $code $(head -c 200 /tmp/runway_dispatch_resp | tr -d '\n')"
  fi
fi
exit 0
