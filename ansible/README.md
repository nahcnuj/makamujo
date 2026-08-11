# Ansible

稼働環境のサーバー管理ディレクトリです。

## Requirements

- [uv](https://github.com/astral-sh/uv)

## Setup

```sh
cd ansible # from the project root
uv venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
uv pip install -r requirements.txt
```

Inventory: `inventory/hosts.yml`（ホスト `vps` → `makamujo`）。

## Ansible Vault（Niconama stream key）

git には平文キーを置かず、Vault で暗号化して管理します。

OBS が読む場所は **`service.json` の `settings.key` だけ**です。  
Playbook はその JSON にだけ書き込みます（別ファイルや起動時注入はしません）。

```
Vault (niconama_stream_key)
    →  ansible playbooks/0_secrets.yml
    →  /opt/src/makamujo/obs-studio/basic/profiles/Makamujo/service.json
```

リポジトリ上の `service.json` は `key: ""` のまま commit。  
サーバ上だけキー入り（`2_makamujo` の git force 後は vault があれば自動で書き戻し）。

### 初回

```sh
cd ansible
source .venv/bin/activate

cp inventory/group_vars/all/vault.yml.example inventory/group_vars/all/vault.yml
# niconama_stream_key を実キーに編集

ansible-vault encrypt inventory/group_vars/all/vault.yml

# 任意: パスワードファイル（git に入れない）
echo 'your-vault-passphrase' > .vault_pass
chmod 600 .vault_pass
```

`inventory/group_vars/all/vault.yml` は **暗号化済みなら commit してよい**。

### キー更新 / 適用

```sh
ansible-vault edit inventory/group_vars/all/vault.yml --ask-vault-pass
ansible-playbook playbooks/0_secrets.yml --ask-vault-pass
```

### 確認（サーバ）

```sh
python3 -c "import json; k=json.load(open('/opt/src/makamujo/obs-studio/basic/profiles/Makamujo/service.json'))['settings'].get('key',''); print('key_len', len(k))"
```

### 関連 playbook

| Playbook | 内容 |
|----------|------|
| `playbooks/0_secrets.yml` | Vault → `service.json` のみ |
| `playbooks/2_makamujo.yml` | デプロイ後、vault があれば同じ書き込みを再実行 |
| `playbooks/0_obs.yml` | OBS Flatpak のみ（キーは触らない） |

## Playbooks（概要）

| 順 | ファイル | 役割 |
|----|----------|------|
| 0 | `0_bootstrap.yml` | ベース |
| 0 | `0_desktop.yml` | Xvfb / VNC / デスクトップ |
| 0 | `0_obs.yml` | OBS Flatpak |
| 0 | `0_secrets.yml` | stream key → service.json |
| 1 | `1_bun.yml` | Bun |
| 2 | `2_makamujo.yml` | アプリ clone / 依存 / TLS / key 再適用 |
