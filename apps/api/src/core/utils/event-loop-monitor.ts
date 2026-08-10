import { monitorEventLoopDelay } from "node:perf_hooks";

const histogram = monitorEventLoopDelay({
  resolution: 20,
});

histogram.enable();

setInterval(() => {
  const max = histogram.max / 1e6;
  const mean = histogram.mean / 1e6;

  if (max > 1000) {
    console.warn(
      `[EventLoop] High delay detected. max=${max.toFixed(
        2,
      )}ms mean=${mean.toFixed(2)}ms`,
    );
  }

  histogram.reset();
}, 10_000);
