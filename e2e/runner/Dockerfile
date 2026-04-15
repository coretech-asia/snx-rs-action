FROM ghcr.io/catthehacker/ubuntu:act-24.04

USER root

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      sudo \
      openssh-client \
      iproute2 \
      iptables \
      iputils-ping \
      procps \
      net-tools \
      jq \
      unzip \
      xz-utils \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN if ! id -u runner >/dev/null 2>&1; then useradd -m -s /bin/bash runner; fi
RUN printf 'runner ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/runner && chmod 0440 /etc/sudoers.d/runner

USER runner
