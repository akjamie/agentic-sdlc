# Jenkins for testing the asdlc CI gate, with Node + OpenSpec baked in.
#   docker build -t asdlc-jenkins:test jenkins/
# Base image is proxied via daocloud (the local docker mirrors 403 on jenkins/*).
FROM docker.m.daocloud.io/jenkins/jenkins:lts-jdk17

USER root

# Node 20 (required by openspec + the asdlc CLI). Base image already has
# curl + tar + git; we use the .tar.gz build so no xz is needed.
RUN curl -fsSL https://registry.npmmirror.com/-/binary/node/v20.19.0/node-v20.19.0-linux-x64.tar.gz -o /tmp/node.tar.gz \
    && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.gz \
    && node --version && npm --version

# PINNED tool versions: CI must be reproducible. Never use @latest here.
ARG OPENSPEC_VERSION=1.13.2
RUN npm install -g @fission-ai/openspec@${OPENSPEC_VERSION} --registry=https://registry.npmmirror.com

# Allow git to read/write the bind-mounted repos (owner differs from jenkins user).
RUN git config --system --add safe.directory '*'

# Skip the setup wizard so the controller is usable immediately (test only).
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"

USER jenkins

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugins -f /usr/share/jenkins/ref/plugins.txt

# Creates the gate job at startup from a mounted pipeline script.
COPY init.groovy.d/ /usr/share/jenkins/ref/init.groovy.d/
