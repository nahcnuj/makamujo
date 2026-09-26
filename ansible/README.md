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
| 0 | `0_desktop.yml` | 配信用 Xvfb `:10` / ログイン用 `:11` / VNC / noVNC |
| 0 | `0_obs.yml` | OBS Flatpak |
| 0 | `0_secrets.yml` | stream key → service.json |
| 1 | `1_bun.yml` | Bun |
| 2 | `2_makamujo.yml` | アプリ clone / 依存 / TLS / key 再適用 |

## Niconico に人がログインする（noVNC）

`bin/x/reserve.ts` は `playwright/.auth/` のプロファイルを共有するため、Niconico のセッションが切れるとログインし直しになります。パスワードと Turnstile は人が解くしかないので、`0_desktop.yml` は**そのときだけ**ログイン用の X ディスプレイをブラウザ越しに見せるようにします。

- 配信ディスプレイ `:10`（OBS とゲーム）
- ログイン用ディスプレイ `:11`（1280x1024、ブラウザ 1 枚だけ）

**この 2 つは別物です。** `reserve.ts` は OBS・ゲーム・配信状態に触れません。`:11` には Chromium が 1 枚あるだけで、OBS のウィンドウも stream key を含む設定画面もゲームセッションも入りません。`:10` を共有しないのは、その中の\|\*\*秘匿情報ごと公開してしまう\*\*ためです。

**常時起動しません。** 3 つの unit はどれも `enabled` にせず、`bin/x/reserve.ts` が実行中にだけ `systemctl start` し、終了時に `systemctl stop` します。理由:

- 認証がない（`x11vnc` も `-nopw`）ため、到達した人はそのまま Niconico のセッションを操作できてしまう
- ログインが必要なのは `reserve.ts` の実行中だけで、それ以外の時間に 24 時間エンドポイントを残す理由がない

| ポート | 中身 | 束縛 | 稼働 |
|--------|------|------|------|
| 5900 | `makamujo-x11vnc`（RFB、配信用 `:10`） | `127.0.0.1` のみ | 常時（従来どおり） |
| 5901 | `makamujo-login-x11vnc`（RFB、ログイン用 `:11`） | `127.0.0.1` のみ | `reserve.ts` 実行中のみ |
| 6080 | `makamujo-novnc`（websockify、noVNC の静的ファイルも配信） | `127.0.0.1` のみ | `reserve.ts` 実行中のみ |

**認証はありません。** 到達経路は SSH トンネルのみにしてください。セキュリティグループでも 6080 を開かないこと。リポジトリ内のどの playbook にも 6080 を開ける処理はありません。公開は VPS プロバイダのセキュリティグループ側の責務です。

`reserve.ts` を走らせるとログに URL が出ます。ニコロのセッションが切れていると、ログイン用ディスプレイ `:11` にログインページが開き、15 分間ログインを待ちます。トンネルを張ってブラウザでその URL を開き、Niconico にログインしてください。

`-y`（headless）で起動した場合でも、セッションが切れていれば**自動的に headful へ切り替えて** `:11` にログインページを出します。headless のままだと誰も画面を見られないためです。この再起動のあいだも noVNC は稼働しています。

手元からトンネルを張る:

```sh
ssh -N -L 6080:127.0.0.1:6080 root@HOST
```

ブラウザで次を開く（`path=websockify` は noVNC の既定 WebSocket パス）:

```
http://127.0.0.1:6080/vnc.html?path=websockify&autoconnect=true&resize=scale
```

`autoconnect=true` を付けると接続確認のダイアログを飛ばし、`resize=scale` はウィンドウに収まるようフレームバッファを縮めます。UI を省いた `vnc_lite.html` を使うなら `http://127.0.0.1:6080/vnc_lite.html?path=websockify&autoconnect=true` です。

VPS 側の状態確認:

```sh
systemctl status makamujo-novnc makamujo-login-x11vnc makamujo-login-xvfb
ss -ltn | grep -E '6080|5901'   # 127.0.0.1 だけであること。出ていなければ reserve.ts 未実行
```

CD は `0_desktop.yml` を流しません。`2_makamujo.yml` の "Restart streaming infra" にも `makamujo-novnc.service` / `makamujo-login-*` は含めていないので、CD が意図せず立ち上げることはありません。パッケージと unit が入る machine は `0_desktop.yml` を手動で流したものです。初回は次で適用してください。

```sh
bin/vault-session run ansible-playbook ansible/playbooks/0_desktop.yml
```

回帰チェック: `bun test tests/ansible-novnc.test.ts`（`0_desktop.yml` に展開される unit が loopback 束縛であること、**`enabled` になっていないこと**、`:10` を参照しないこと、`2_makamujo.yml` が再起動対象に含まないこと、`reserve.ts` が起動・停止を持ち回すことを検証します）。ライフサイクル本体は `lib/Browser/niconicoSession.ts` で、`bun test lib/Browser/niconicoSession.test.ts` が単体で叩きます。

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

`journalctl -u fail2ban` をそのまま実行するだけで、BAN した IP ごとに「SSH リクエストを受け取ってから BAN するまで」の秒数が実績として journal に残ります。fail2ban の BAN 時に `bin/honeypot-report` が計測し、`systemd-cat` で fail2ban の unit に書き込みます（pipe 不要）。fail2ban 自身のログも journal に出す構成（`logtarget = STDOUT`）なので、`[sshd] Found` / `[sshd] Ban` の行も同じ出力に並びます。

```sh
journalctl -u fail2ban
# → [sshd] caught 203.0.113.5 for 1s since 2026-09-19 03:11:44
```

- リクエスト受信時刻 = その IP の**最初の** fail2ban `Found` イベントに埋め込まれた sshd ログ側のタイムスタンプ。`LoginGraceTime 0` で保持されている間も認証を続けるとイベントが積み上がるため、`Found` が BAN 後も増えていく様子も同じ出力で確認できます。
- 設定: `ansible/playbooks/0_ssh_honeypot.yml` が `bin/honeypot-report` を `/usr/local/bin/honeypot-report` に導入し（アプリのデプロイとは独立）、`etc/fail2ban/`（action.d / fail2ban.local / jail.d）を `/etc/fail2ban/` に配置するため、sshd jail の `action` に `honeypot-report` が載り、fail2ban は journal にログ出力します。jail は `backend = systemd` + `journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd + _COMM=sshd-session` で直接 ssh journal を読むため、`/var/log/auth.log` が無い環境（rsyslog 未導入の Ubuntu cloud image など）でも動作します。設定自体は CI の `fail2ban-config` ジョブで `fail2ban-client -t` と journal 読取設定の回帰チェックを行います。
- 手動再現:
  ```sh
  journalctl -u fail2ban --since=-24h | bin/honeypot-report --ip 203.0.113.5
  ```
- 単体テスト: `bash tests/bin/honeypot-report.test.sh`。

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
