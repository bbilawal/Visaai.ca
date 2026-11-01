# VisaAI — Off-host backup & restore (SEC-7009)

Two layers:
1. **`backup.sh`** — local `pg_dump` to `${BACKUP_DIR}` on the DB host (already present).
2. **`backup-offsite.sh` / systemd `visaai-offsite-backup.{service,timer}`** — ships
   those dumps, **encrypted with restic**, to operator-controlled object storage.
   restic encrypts locally with `RESTIC_PASSWORD` before upload, so the remote
   store only ever holds ciphertext — passports/bank statements never leave the
   host in plaintext.

## One-time operator setup (on the VPS)

```bash
apt-get install -y restic                      # or install the static binary
mkdir -p /etc/visaai && chmod 700 /etc/visaai
cat > /etc/visaai/offsite-backup.env <<EOF     # chmod 600, root-only
RESTIC_REPOSITORY=s3:s3.<region>.amazonaws.com/visaai-backups   # or b2:/rclone:
RESTIC_PASSWORD=<STRONG-PASSPHRASE-STORED-SEPARATELY>
AWS_ACCESS_KEY_ID=<...>
AWS_SECRET_ACCESS_KEY=<...>
BACKUP_DIR=/backups
EOF
chmod 600 /etc/visaai/offsite-backup.env

# initialise the encrypted repo ONCE
set -a; . /etc/visaai/offsite-backup.env; set +a
restic init

# install + enable the daily timer
cp infra/self-hosted/visaai-offsite-backup.service /etc/systemd/system/
cp infra/self-hosted/visaai-offsite-backup.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now visaai-offsite-backup.timer
systemctl start visaai-offsite-backup.service      # first push now
```

> **Store `RESTIC_PASSWORD` somewhere other than the VPS** (a password manager).
> Lose it and every backup is permanently unrecoverable — that is by design.

## Verify

```bash
set -a; . /etc/visaai/offsite-backup.env; set +a
restic snapshots                 # should list a snapshot per run
restic check --read-data-subset=5%   # periodic integrity (reads actual data)
systemctl list-timers | grep visaai  # next scheduled run
```

## Restore drill (do this at least once — an untested backup is not a backup)

```bash
set -a; . /etc/visaai/offsite-backup.env; set +a
# 1. pull the latest dump out of the encrypted repo
restic restore latest --target /tmp/restore --include /backups
ls -l /tmp/restore/backups/            # visaai-<stamp>.dump

# 2. restore into a THROWAWAY db first (never straight over prod)
docker exec -i selfhosted_db createdb -U postgres restore_test
docker exec -i selfhosted_db pg_restore -U postgres -d restore_test --no-owner \
   < /tmp/restore/backups/visaai-<stamp>.dump
docker exec -i selfhosted_db psql -U postgres -d restore_test -c '\dt' | head
docker exec -i selfhosted_db dropdb -U postgres restore_test
```

## RPO / RTO
- **RPO** ~24h (daily timer) — tighten `OnCalendar` if lower loss tolerance is needed.
- **RTO** = time to pull latest snapshot + `pg_restore` (~minutes for this dataset).
- The remote retention (`--keep-daily 7 --keep-weekly 4 --keep-monthly 6`) is
  independent of the local prune, so a compromised host cannot delete history.
