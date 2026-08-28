# ==================================================================== #
#  karo/sandbox-base — the machine the agent actually gets
#
#  This is the default value of SANDBOX_IMAGE. Every shell command an
#  agent runs, every file it writes, every dependency it installs lands
#  in a container built from this image. Treat everything inside it as
#  hostile: the contents are driven by a language model reacting to text
#  that a user (or a web page, or a tool result) supplied.
#
#  Build:
#      docker build -t karo/sandbox-base:1 docker/sandbox-base
#
#  Debian slim rather than Alpine on purpose: agents `pip install` and
#  `npm install` packages with native extensions all day, and musl
#  wheels/prebuilds are a constant source of "works on my laptop"
#  failures. The extra ~90 MB buys a boring, glibc-compatible toolchain.
#
#  ------------------------------------------------------------------
#  RUNTIME FLAGS THE PROVIDER MUST PASS
#  ------------------------------------------------------------------
#  The image is only half of the isolation. `SandboxProvider`
#  implementations MUST create containers with all of the following;
#  none of them can be baked into a Dockerfile:
#
#    --network karo-sandbox        attach to the internal network from
#                                  docker-compose.yml. No egress, and no
#                                  route to 169.254.169.254, so agent
#                                  code cannot read cloud credentials.
#    --cap-drop=ALL                drop every Linux capability. Nothing
#                                  in here needs one.
#    --security-opt=no-new-privileges   setuid binaries can never raise
#                                  privileges, belt-and-braces with the
#                                  `chmod a-s` sweep below.
#    --read-only                   read-only root filesystem wherever the
#                                  workload allows it, paired with
#                                  writable tmpfs mounts for /tmp and
#                                  /home/karo/.cache and a real volume
#                                  for /workspace. Some templates (agents
#                                  that apt-install at runtime) need a
#                                  writable root — those get a lower
#                                  pids/memory ceiling instead.
#    --pids-limit=512              a fork bomb costs the container, not
#                                  the worker node.
#    --memory / --memory-swap      from plans.maxSandboxMemoryMb. Set
#                                  memory-swap equal to memory so the
#                                  container cannot swap past its cap.
#    --cpus                        from plans.maxSandboxCpuCores. This is
#                                  also the number compute billing is
#                                  metered against.
#    --user 10001:10001            never override back to root.
#    --tmpfs /tmp:rw,noexec,nosuid,size=256m
#
#  And one prohibition, which matters more than any flag above:
#
#    NEVER bind-mount /var/run/docker.sock into this container.
#  Access to the daemon socket is equivalent to root on the worker node
#  and would let an agent start a privileged container that mounts the
#  host filesystem. Docker-in-Docker for `allowDocker` plans is done with
#  a separate rootless daemon on an isolated worker, not by sharing the
#  host socket.
# ==================================================================== #

FROM debian:12-slim

ARG NODE_VERSION=22.11.0
ARG KARO_UID=10001
ARG KARO_GID=10001
ARG DEBIAN_FRONTEND=noninteractive

LABEL org.opencontainers.image.title="karo-sandbox-base" \
      org.opencontainers.image.description="Base runtime for Karo agent sandboxes" \
      org.opencontainers.image.vendor="Karo" \
      org.opencontainers.image.licenses="MIT" \
      dev.karo.sandbox="true"

# ---------------------------------------------------------------- #
#  System packages
#
#  bash + coreutils   the agent's shell tools are assumed POSIX+GNU
#  ca-certificates    TLS trust store for git/curl/npm/pip
#  curl               the agent reaches for it constantly
#  git                clone, diff, commit — the core coding loop
#  ripgrep            what the agent's search tool shells out to
#  jq                 JSON wrangling in generated shell one-liners
#  build-essential    native npm/pip modules need a C toolchain
#  python3 + venv     PEP 668 marks Debian's python as externally
#                     managed, so agents create a venv rather than
#                     pip-installing into the system interpreter
#  xz-utils           unpacks the Node tarball below
# ---------------------------------------------------------------- #
RUN set -eux; \
    apt-get update; \
    apt-get install --no-install-recommends -y \
        bash \
        build-essential \
        ca-certificates \
        coreutils \
        curl \
        git \
        gnupg \
        jq \
        less \
        libffi-dev \
        libssl-dev \
        locales \
        openssh-client \
        pkg-config \
        procps \
        python3 \
        python3-dev \
        python3-pip \
        python3-venv \
        ripgrep \
        tini \
        unzip \
        xz-utils \
    ; \
    sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen; \
    locale-gen en_US.UTF-8; \
    rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------- #
#  Node.js — official tarball, checksum-verified.
#
#  Not NodeSource: adding a third-party apt repository means every
#  `apt-get update` inside the sandbox trusts another signing key. The
#  tarball is pinned by version and verified against the SHASUMS256.txt
#  published alongside it, so the layer is reproducible.
# ---------------------------------------------------------------- #
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
        amd64) node_arch='x64' ;; \
        arm64) node_arch='arm64' ;; \
        armhf) node_arch='armv7l' ;; \
        *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    tarball="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    cd /tmp; \
    curl -fsSLO --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"; \
    curl -fsSLO --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " ${tarball}\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "${tarball}" -C /usr/local --strip-components=1 --no-same-owner \
        --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md; \
    rm -f "${tarball}" SHASUMS256.txt; \
    node --version; \
    npm --version

# ---------------------------------------------------------------- #
#  Unprivileged user
#
#  uid 10001 is deliberately outside the range Debian hands out to
#  system and first-login accounts, so a stray file owned by 10001 on a
#  worker node is unambiguously sandbox output.
# ---------------------------------------------------------------- #
RUN set -eux; \
    groupadd --gid "${KARO_GID}" karo; \
    useradd --uid "${KARO_UID}" --gid "${KARO_GID}" \
        --home-dir /home/karo --create-home --shell /bin/bash karo; \
    mkdir -p /workspace /home/karo/.cache /home/karo/.npm-global; \
    chown -R "${KARO_UID}:${KARO_GID}" /workspace /home/karo

COPY --chmod=0555 entrypoint.sh /usr/local/bin/karo-entrypoint

# ---------------------------------------------------------------- #
#  Strip setuid/setgid bits.
#
#  Nothing in a sandbox has any business calling `su`, `mount`, `passwd`
#  or `newgrp`. Clearing the bits removes a whole class of local
#  privilege-escalation primitives before --security-opt=no-new-privileges
#  even has to do its job. Run last so it also covers anything the Node
#  install dropped in.
# ---------------------------------------------------------------- #
RUN set -eux; \
    find / -xdev -type f -perm /6000 -exec chmod a-s '{}' + 2>/dev/null || true; \
    rm -rf /root/.npm /root/.cache /tmp/*

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    HOME=/home/karo \
    NPM_CONFIG_PREFIX=/home/karo/.npm-global \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH=/home/karo/.npm-global/bin:/home/karo/.local/bin:/usr/local/bin:/usr/bin:/bin \
    KARO_SANDBOX=1 \
    TERM=xterm-256color

USER karo
WORKDIR /workspace

# tini is PID 1 so orphaned processes from a killed agent command get
# reaped instead of accumulating until --pids-limit is hit.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/karo-entrypoint"]
CMD ["bash"]
