# Release assembly tests

`test_build.py` verifies the real-runtime staging boundary rejects non-loopback,
online, concurrent and incomplete asset configurations. `test_assets.py` checks
verified/offline caching, incomplete downloads, archive extraction boundaries,
demo-profile rejection, output bounds and the ZIP/checksum round trip. Run
`python -m unittest discover -s app/release/tests -v` from the repository root.

These checks do not implement the separately trusted production release verifier.
Signature, platform and complete-bundle verification remain required by the SDD.
