#define _POSIX_C_SOURCE 202405L
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>

#define MAX_DEK 4096

static int ttl(void)
{
    const char *e = getenv("VAULT_SESSION_TTL");
    int v;

    if (!e || !*e)
        return 900;
    v = atoi(e);
    return v > 0 ? v : 900;
}

static void die(const char *m)
{
    fprintf(stderr, "%s\n", m);
    exit(1);
}

static void usage(const char *argv0)
{
    fprintf(stderr, "usage: %s available|store|fetch|delete|help [path]\n", argv0);
}

static int cmd_available(void)
{
    return 0;
}

static int cmd_store(const char *path)
{
    unsigned char buf[MAX_DEK];
    ssize_t n = read(STDIN_FILENO, buf, sizeof buf);
    int fd;
    uint64_t exp;
    pid_t pid;

    if (n <= 0)
        die("empty DEK");
    if (!path || !*path)
        die("path required");
    unlink(path);
    fd = open(path, O_CREAT | O_WRONLY | O_TRUNC, 0600);
    if (fd < 0)
        die("open failed");
    exp = (uint64_t)time(NULL) + (uint64_t)ttl();
    if (write(fd, &exp, sizeof exp) != (ssize_t)sizeof exp)
        die("write exp");
    if (write(fd, buf, (size_t)n) != n)
        die("write dek");
    close(fd);
    pid = fork();
    if (pid == 0) {
        sleep((unsigned)ttl());
        unlink(path);
        _exit(0);
    }
    return 0;
}

static int cmd_fetch(const char *path)
{
    int fd;
    uint64_t exp;
    unsigned char buf[MAX_DEK];
    ssize_t n;

    if (!path || !*path)
        return 1;
    fd = open(path, O_RDONLY);
    if (fd < 0)
        return 1;
    if (read(fd, &exp, sizeof exp) != (ssize_t)sizeof exp) {
        close(fd);
        return 1;
    }
    if ((uint64_t)time(NULL) >= exp) {
        close(fd);
        unlink(path);
        return 1;
    }
    n = read(fd, buf, sizeof buf);
    close(fd);
    if (n <= 0)
        return 1;
    if (fwrite(buf, 1, (size_t)n, stdout) != (size_t)n)
        return 1;
    return 0;
}

static int cmd_delete(const char *path)
{
    if (path && *path)
        unlink(path);
    return 0;
}

int main(int argc, char **argv)
{
    const char *cmd;
    const char *path;

    if (argc < 2) {
        usage(argv[0]);
        return 2;
    }
    cmd = argv[1];
    path = argc >= 3 ? argv[2] : NULL;

    if (!strcmp(cmd, "help") || !strcmp(cmd, "-h") || !strcmp(cmd, "--help")) {
        usage(argv[0]);
        return 0;
    }
    if (!strcmp(cmd, "available"))
        return cmd_available();
    if (!strcmp(cmd, "store"))
        return cmd_store(path);
    if (!strcmp(cmd, "fetch"))
        return cmd_fetch(path);
    if (!strcmp(cmd, "delete"))
        return cmd_delete(path);

    usage(argv[0]);
    return 2;
}
