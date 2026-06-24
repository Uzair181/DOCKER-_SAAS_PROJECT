const express = require("express");

const app = express();
app.use(express.json());

const queue = [];
let processing = false;

const processQueue = async () => {
  if (processing) {
    return;
  }

  processing = true;

  while (queue.length > 0) {
    const job = queue.shift();
    console.log(
      JSON.stringify({
        service: "notification-service",
        event: job.type,
        recipient: job.to || null,
        subject: job.subject || null,
        queuedAt: job.queuedAt,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  processing = false;
};

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "notification-service",
    queuedJobs: queue.length,
  });
});

app.post("/internal/notifications", (req, res) => {
  const missing = ["type"].filter((field) => {
    const value = req.body[field];
    return value === undefined || value === null || String(value).trim() === "";
  });

  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(", ")}`,
    });
  }

  queue.push({
    type: String(req.body.type),
    to: req.body.to ? String(req.body.to) : null,
    subject: req.body.subject ? String(req.body.subject) : null,
    message: req.body.message ? String(req.body.message) : null,
    queuedAt: new Date().toISOString(),
  });

  setImmediate(processQueue);

  return res.status(202).json({
    message: "Notification queued",
    queuedJobs: queue.length,
  });
});

app.listen(process.env.PORT || 4004, () => {
  console.log("Notification service running on 4004");
});
