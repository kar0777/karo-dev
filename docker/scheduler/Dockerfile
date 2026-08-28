# ==================================================================== #
#  Karo — scheduler
#
#  Three maintenance endpoints have to be called on a timer, or features
#  Karo bills for silently do not happen:
#
#    · idle sandboxes are never slept, so customers pay for idle time;
#    · a team whose balance ran out never auto-tops-up, because nothing
#      meters once it has stopped running agents;
#    · a downgrade parked until the end of a paid period never lands.
#
#  The app cannot do this on an in-process `setInterval` — with more than
#  one replica each would run its own copy, and the route docblocks say
#  so. This container is the timer instead: it holds no state, talks to
#  the app over the private compose network, and authenticates with
#  CRON_SECRET.
#
#  Build:  docker build -t karo/scheduler:1 docker/scheduler
#
#  ------------------------------------------------------------------
#  WHY THIS RUNS AS ROOT
#  ------------------------------------------------------------------
#  busybox crond expects to be root: it derives the account to run a job
#  under from the crontab's *filename*, and a non-root crond cannot
#  perform that switch. Running it unprivileged is a well-known source of
#  a scheduler that starts, looks healthy and never fires.
#
#  So root it is, and the isolation is bought elsewhere instead — see
#  docker-compose.prod.yml, which gives this service `cap_drop: ALL`, a
#  read-only root filesystem, `no-new-privileges`, a pids limit, no
#  published port and no route to the internet. Root in a container with
#  no capabilities and nothing to write to is a much smaller surface than
#  the name suggests, and the only secret present is the one the jobs
#  need in order to work at all.
# ==================================================================== #

FROM alpine:3.22

# curl issues the requests. tini reaps the short-lived job processes so a
# long-running crond cannot accumulate zombies. tzdata makes TZ mean
# something, which matters for the hourly job's offset.
RUN apk add --no-cache curl tini tzdata

COPY --chmod=0755 karo-job.sh /usr/local/bin/karo-job
COPY --chmod=0755 entrypoint.sh /usr/local/bin/entrypoint

# busybox crond reads /etc/crontabs/<user>; this one runs as root.
COPY --chmod=0600 crontab /etc/crontabs/root

# Schedules are UTC unless overridden, so "17 past the hour" is the same
# instant regardless of the host's local zone.
ENV TZ=UTC

# No HEALTHCHECK: liveness here means "fires on schedule", which a probe
# cannot see. The job log lines are the signal, and a failed job exits
# non-zero and says why.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint"]
