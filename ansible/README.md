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

`main` への push で `.github/workflows/cd.yml` が走り、そのコミットの CI（`.github/workflows/ci.yml` の **push** run）が success になってから、先に `playbooks/0_ssh_honeypot.yml`（22 番 sshd の公開鍵以外を沈黙）、続けて `playbooks/2_makamujo.yml` を VPS に適用します。checkout 対象は playbook どおり `main` です。

必要な GitHub Secrets（Environment `prod` またはリポジトリ Secrets）:

| Secret | 必須 | 内容 |
|--------|------|------|
| `VPS_SSH_PRIVATE_KEY` | yes | VPS に入る SSH 秘密鍵 |
| `VPS_SSH_HOST` | yes | SSH 先（IP またはホスト名）。inventory の `makamujo` エイリアスは runner では使わない |
| `ANSIBLE_VAULT_PASSWORD` | yes | `inventory/group_vars/all/vault.yml` の復号パスワード |
| `VPS_SSH_USER` | no | SSH ユーザー。省略時 `root` |
| `VPS_SSH_KNOWN_HOSTS` | no | `ssh-keyscan` 形式の known_hosts。未設定時は実行時に `ssh-keyscan` |

デプロイ job は Environment `prod` を使う（`main` のみ）。required reviewers を付けると、CI 通過後の実デプロイだけ承認待ちにできます。Environment URL は番組ページ（`https://live.nicovideo.jp/watch/user/14171889`）へのショートカットです。

## Playbooks（概要）

| 順 | ファイル | 役割 |
|----|----------|------|
| 0 | `0_bootstrap.yml` | ベース |
| 0 | `0_ssh_honeypot.yml` | 22 番は sshd のまま。公開鍵認証できない相手は応答せず保持する |
| 0 | `0_desktop.yml` | Xvfb / VNC / デスクトップ |
| 0 | `0_obs.yml` | OBS Flatpak |
| 0 | `0_secrets.yml` | stream key → service.json |
| 1 | `1_bun.yml` | Bun |
| 2 | `2_makamujo.yml` | アプリ clone / 依存 / TLS / key 再適用 |

## SSH ハニーポット

22 番はこれまでどおり OpenSSH が待ち受けます。公開鍵以外の認証は出さず、鍵が通らない接続は切らずに保持します（`LoginGraceTime 0`）。一度失敗した IP は fail2ban が **DROP** するので、以降は応答しません。パスワードでは入れません。CD と手元は鍵のまま 22 番へ入ります。

手元から playbook だけ流す場合（リポジトリルート、Vault セッション利用）:

```sh
bin/vault-session run ansible-playbook ansible/playbooks/0_ssh_honeypot.yml
```

### 禁止 IP の確認

1. 鍵で VPS の 22 番へ入る。

```sh
ssh root@HOST
```

2. fail2ban の sshd jail を見る。`Banned IP list` が禁止中の IP。

```sh
fail2ban-client status sshd
```

jail が無い（`Sorry but the jail 'sshd' does not exist`）場合は `0_ssh_honeypot.yml` がまだ当たっていません。一覧が空なら、まだ誰も BAN されていません。

3. IP だけ欲しいとき、または iptables 側を見るとき。

```sh
fail2ban-client get sshd banip
iptables -nL f2b-sshd
```

4. 誤って自分を DROP したら、VPS 上で解除する。

```sh
fail2ban-client set sshd unbanip A.B.C.D
```

sshd / fail2ban のログ:

```sh
ss -tnp | grep sshd
journalctl -u ssh -u fail2ban -f
```

### 捕まえられた時間の確認

BAN 済み IP ごとに「SSH リクエストを受け取ってから BAN するまで」の秒数（`caught_s`）を出力します。`LoginGraceTime 0` で接続を保持している間も認証を続けると fail2ban のイベントが積み上がるため、`last_seen` が BAN 後も伸び続けていたら、DROP 後も叩き続けられていたことが分かります。

```sh
journalctl -u fail2ban | bin/honeypot-report -
# 単体テスト: bash tests/bin/honeypot-report.test.sh
```

/var/log/fail2ban.log がある場合は引数なしでも読めます。ログファイルを直接渡すか、`-` で標準入力から読めます。

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
