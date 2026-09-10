# Ansible

稼働環境のサーバー管理ディレクトリです。

## Requirements

- [uv](https://github.com/astral-sh/uv)
- One of the following for `bin/vault-session` (short-lived Vault password):
  - [`secret-tool`](https://wiki.gnome.org/Projects/Libsecret) (libsecret)
  - [`keyctl`](https://git.kernel.org/pub/scm/linux/kernel/git/dhowells/keyutils.git) (keyutils)

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

Vault パスワードを短時間だけ預ける場合（リポジトリルート）:

    bin/vault-session login
    bin/vault-session run ansible-playbook ansible/playbooks/0_secrets.yml
    bin/vault-session logout

`login` 後 900 秒で無効。終わったら `logout` を推奨。

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

## GitHub Actions CD

`main` への push で `.github/workflows/cd.yml` が走り、そのコミットの CI（`.github/workflows/ci.yml` の **push** run）が success になってから `playbooks/2_makamujo.yml` を VPS に適用します。checkout 対象は playbook どおり `main` です。

必要な GitHub Secrets（リポジトリ Secrets。`github-pages` や `copilot` は使わない）:

| Secret | 必須 | 内容 |
|--------|------|------|
| `VPS_SSH_PRIVATE_KEY` | yes | VPS に入る SSH 秘密鍵 |
| `VPS_SSH_HOST` | yes | SSH 先（IP またはホスト名）。inventory の `makamujo` エイリアスは runner では使わない |
| `ANSIBLE_VAULT_PASSWORD` | yes | `inventory/group_vars/all/vault.yml` の復号パスワード |
| `VPS_SSH_USER` | no | SSH ユーザー。省略時 `root` |
| `VPS_SSH_KNOWN_HOSTS` | no | `ssh-keyscan` 形式の known_hosts。未設定時は実行時に `ssh-keyscan` |

## Playbooks（概要）

| 順 | ファイル | 役割 |
|----|----------|------|
| 0 | `0_bootstrap.yml` | ベース |
| 0 | `0_desktop.yml` | Xvfb / VNC / デスクトップ |
| 0 | `0_obs.yml` | OBS Flatpak |
| 0 | `0_secrets.yml` | stream key → service.json |
| 1 | `1_bun.yml` | Bun |
| 2 | `2_makamujo.yml` | アプリ clone / 依存 / TLS / key 再適用 |

## デプロイ後の再起動（ad-hoc）

`2_makamujo.yml` はコードと依存の反映までで、プロセス再起動は行いません。

inventory に Vault 変数があるため、復号付きで実行します（リポジトリルートから）:

    bin/vault-session run ansible vps -i ansible/inventory/hosts.yml -b -m shell -a 'cd /opt/src/makamujo && ./bin/stop && ./bin/start'

`ansible/` ディレクトリにいる場合:

    source .venv/bin/activate
    ../bin/vault-session run ansible vps -i inventory/hosts.yml -b -m shell -a 'cd /opt/src/makamujo && ./bin/stop && ./bin/start'

VPS に SSH して直接実行してもよいです:

    cd /opt/src/makamujo && ./bin/stop && ./bin/start

コードがまだ古い場合は、先に `2_makamujo.yml` を流すか、VPS 上で `git fetch` と `git reset --hard origin/main` してから上記を実行します。
