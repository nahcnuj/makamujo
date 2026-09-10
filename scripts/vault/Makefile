.PHONY: all clean

ROOT := $(abspath ../..)
DIST := $(ROOT)/dist/bin

all: $(DIST)/dek

$(DIST)/dek: shm/dek.c
	mkdir -p $(DIST)
	$(CC) -o $@ shm/dek.c

clean:
	rm -f $(DIST)/dek
