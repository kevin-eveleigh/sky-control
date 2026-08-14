#!/bin/zsh
# Backward-compatible entry point retained for existing installations.
exec zsh "${0:A:h}/service.sh" install
