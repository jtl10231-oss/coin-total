#!/usr/bin/env bash
# 매일 09시(한국 시간)에 비공개 런웨이 저장소의 알림 점검을 한 번 켬 (하루 1회)
[ -z "$RUNWAY_DISPATCH_TOKEN" ] && exit 0
H=$(TZ=Asia/Seoul date +%H); D=$(TZ=Asia/Seoul date +%F)
MARK="/tmp/runway_dispatch_test_$D"
if [ "$H" = "12" ] && [ ! -f "$MARK" ]; then
  if GH_TOKEN="$RUNWAY_DISPATCH_TOKEN" gh workflow run check.yml -R jtl10231-oss/runway-data -f mode=daily >/dev/null 2>&1; then
    touch "$MARK"; echo "runway daily check started"
  else
    echo "runway daily check start failed (retry next minute)"
  fi
fi
exit 0
