// PM2 en Hetzner: un único proceso, reinicio automático y tope de memoria.
module.exports = {
  apps: [
    {
      name: "ringover",
      cwd: "/opt/ringover",
      script: "dist/server.js",
      node_args: "--env-file=/opt/ringover/.env --disable-warning=ExperimentalWarning",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "300M",
      kill_timeout: 6000,
      time: true,
      env: { NODE_ENV: "production" },
    },
  ],
};
