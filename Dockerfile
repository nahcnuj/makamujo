FROM mcr.microsoft.com/devcontainers/base:2.2-debian12

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        curl \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY ansible/ ansible/
RUN pip install --no-cache-dir -r ansible/requirements.txt
RUN ansible-playbook -i localhost, -c local ansible/playbooks/vrt.yml

COPY . .
