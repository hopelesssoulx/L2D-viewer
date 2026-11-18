export class AnimationControls {
  #pickers;
  #getModel;
  #onPlayback;

  constructor(template, hosts, getModel, onPlayback) {
    this.#getModel = getModel;
    this.#onPlayback = onPlayback;
    this.#pickers = hosts.map((host) => {
      host.append(template.content.cloneNode(true));
      const motion = host.querySelector("[data-motion-select]");
      const expression = host.querySelector("[data-expression-select]");
      const play = host.querySelector("[data-play-motion]");
      const error = host.querySelector("[data-animation-error]");
      motion.addEventListener("change", () =>
        this.#run((model) => model.playMotion(Number(motion.value)))
      );
      play.addEventListener("click", () => this.#run((model) => model.playMotion()));
      expression.addEventListener("change", () =>
        this.#run((model) => model.setExpression(Number(expression.value)))
      );
      return { motion, expression, play, error };
    });
    this.select();
  }

  select() {
    const model = this.#getModel();
    for (const { motion, expression } of this.#pickers) {
      const motions = model?.motions.map(({ label }, index) => new Option(label, index)) ?? [];
      const prompt = new Option(motions.length ? "选择动作" : "无动作", -1);
      prompt.disabled = Boolean(motions.length);
      motion.replaceChildren(prompt, ...motions);
      expression.replaceChildren(new Option("无表情", -1),
        ...(model?.expressions.map((label, index) => new Option(label, index)) ?? []));
    }
    this.sync();
  }

  sync() {
    const model = this.#getModel();
    for (const { motion, expression, play, error } of this.#pickers) {
      motion.disabled = !model?.motions.length || model.loadingMotion;
      play.disabled = motion.disabled || model.motionChoice < 0;
      expression.disabled = !model?.expressions.length || model.loadingExpression;
      motion.value = model?.motionChoice ?? -1;
      expression.value = model?.expressionChoice ?? -1;
      motion.title = motion.selectedOptions[0]?.textContent ?? "";
      expression.title = expression.selectedOptions[0]?.textContent ?? "";
      error.textContent = [model?.motionError, model?.expressionError].filter(Boolean).join(" ");
      error.hidden = !error.textContent;
    }
  }

  async #run(action) {
    const model = this.#getModel();
    if (!model) return;
    const pending = action(model);
    this.#onPlayback();
    await pending;
    this.#onPlayback();
  }
}
