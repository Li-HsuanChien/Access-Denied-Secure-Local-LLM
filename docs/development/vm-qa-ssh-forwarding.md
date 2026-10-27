# VM QA over SSH forwarding

Use this workflow when the development server runs on a private QA VM. Keep both services bound to `127.0.0.1` on the VM and forward the ports over SSH; do not open firewall rules or bind either service to a VM network interface.

On the VM, start the deterministic backend host and React frontend in separate SSH sessions:

```sh
.venv/bin/python app/document-qa/backend/dev_host.py
cd app/document-qa/frontend && npm run dev:qa
```

The frontend listens on `127.0.0.1:5173`; the answering host listens on `127.0.0.1:8765`.

From the developer workstation, create the tunnels:

```sh
ssh -N \
  -L 5173:127.0.0.1:5173 \
  -L 8765:127.0.0.1:8765 \
  <ssh-user>@<qa-vm-host>
```

Then open `http://127.0.0.1:5173/qa` locally. The browser reaches the VM frontend through the first tunnel, and its calls to `127.0.0.1:8765` use the second tunnel. The listener on the VM remains loopback-only. Keep the default local ports free for this workflow.

Use the deterministic fake model and seeded test collection for UI QA. Do not download production model weights onto the VM as part of this flow. Stop the frontend and backend processes and close the SSH tunnel when QA is complete.
