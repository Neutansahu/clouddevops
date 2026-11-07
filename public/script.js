document.getElementById("runPipeline")
    .addEventListener("click", async () => {

        const status = document.getElementById("pipelineStatus");
        const button = document.getElementById("runPipeline");

        button.disabled = true;
        status.textContent = "Triggering GitHub Actions...";

        try {
            const response = await fetch("/api/run-pipeline", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                }
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message);
            }

            status.textContent = "Workflow trigger accepted! Check GitHub Actions.";

        } catch (error) {
            status.textContent = "Error: " + error.message;

        } finally {
            button.disabled = false;
        }
    });