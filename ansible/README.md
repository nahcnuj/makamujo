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
Playbook `0_secrets.yml` は次を行います。

1. **`/etc/makamujo/niconama.stream.key`**（mode `0600`）
2. **`/opt/src/makamujo/var/niconama.stream.key`**（同上・アプリ側でも読める）
3. リポジトリが既にあれば **`obs-studio/.../service.json` の `settings.key` をその場で書き換え**

加えて `bin/obs-studio` も起動時にキーファイルから再注入します（git pull で `service.json` が空に戻っても復旧）。

### 初回

```sh
cd ansible
source .venv/bin/activate

# 1) 平文テンプレから vault.yml を作る
cp inventory/group_vars/all/vault.yml.example inventory/group_vars/all/vault.yml
# エディタで niconama_stream_key を実キーに書き換え

# 2) 暗号化（パスワードを決めて入力）
ansible-vault encrypt inventory/group_vars/all/vault.yml

# 3) （任意）パスワードをファイルに保存 — git に入れない
echo 'your-vault-passphrase' > .vault_pass
chmod 600 .vault_pass
# ansible.cfg の vault_password_file を有効化してもよい
```

`inventory/group_vars/all/vault.yml` は **暗号化済みなら commit してよい**。  
`.vault_pass` と平文 `vault.yml` は commit しない。

Ansible は inventory 隣の `group_vars` を読む（`inventory/hosts.yml` → `inventory/group_vars/`）。

### キー更新

```sh
ansible-vault edit inventory/group_vars/all/vault.yml --ask-vault-pass
# または --vault-password-file .vault_pass

ansible-playbook playbooks/0_secrets.yml --ask-vault-pass
```

### 関連 playbook

| Playbook | 内容 |
|----------|------|
| `playbooks/0_secrets.yml` | 秘密だけインストール（キー必須） |
| `playbooks/0_obs.yml` | OBS インストール + vault があればキーも書く |

```sh
ansible-playbook playbooks/0_secrets.yml --ask-vault-pass
ansible-playbook playbooks/0_obs.yml --ask-vault-pass
```

Vault が無い／空のときは `0_obs.yml` はキー書き込みをスキップします。  
`0_secrets.yml` はキー必須で失敗します。

### ローカル確認

サーバ上:

```sh
sudo cat /etc/makamujo/niconama.stream.key   # 権限に注意
# OBS 起動（注入ログ）
sudo -E /opt/src/makamujo/bin/obs-studio   # パスは環境に合わせて
```

リポジトリ内の `service.json` は `key: ""` のまま維持する（秘密はホスト側のみ）。

## Playbooks（概要）

| 順 | ファイル | 役割 |
|----|----------|------|
| 0 | `0_bootstrap.yml` | ベース |
| 0 | `0_desktop.yml` | Xvfb / VNC / デスクトップ |
| 0 | `0_obs.yml` | OBS Flatpak + 任意で stream key |
| 0 | `0_secrets.yml` | Vault 秘密の配置 |
| 1 | `1_bun.yml` | Bun |
| 2 | `2_makamujo.yml` | アプリ clone / 依存 / TLS |
