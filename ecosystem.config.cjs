module.exports = {
  apps: [{
    name: "aura-music",
    script: "./dist/server.js",
    cwd: "/var/www/aura-music",
    env: {
      NODE_ENV: "production",
    }
  }]
};
