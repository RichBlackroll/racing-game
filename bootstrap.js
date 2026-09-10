import { createLoadingScreen } from "./loading.js";

const loading = createLoadingScreen();

// Keep the loader independent of the larger WebGL bundle, including failures.
import("./game-source.js")
  .then(({ main }) => main(loading))
  .catch((error) => {
    console.error(error);
    loading.fail(error);
  });
