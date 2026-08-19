"""Development probes for the Unifi dealer portal.

These are NOT part of the service. They are one-off capture/diagnostic
scripts written while mapping the portal's screens, kept because the
portal's markup is undocumented and re-deriving a selector map is
expensive.

Run them from `scraper/` as a module, so the service's top-level modules
(`order_entry`, `oe_feasibility`, …) stay importable:

    python3 -m devtools.oe_dry_run

Running the file by path (`python3 devtools/oe_dry_run.py`) puts THIS
directory on sys.path instead of `scraper/`, and every `import order_entry`
fails. Use `-m`.

Excluded from the Docker image via .dockerignore — nothing here ships to
the droplet.
"""
