import { t } from "./i18n.js";

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
      const loop = host.querySelector("[data-motion-loop]");
      const loopStatus = host.querySelector("[data-motion-loop-status]");
      const error = host.querySelector("[data-animation-error]");
      motion.addEventListener("change", () =>
        this.#run((model) => model.playMotion(Number(motion.value)))
      );
      play.addEventListener("click", () => this.#run((model) => model.playMotion()));
      loop.addEventListener("change", () => this.#run((model) => model.setMotionLoop(loop.checked)));
      expression.addEventListener("change", () =>
        this.#run((model) => model.setExpression(Number(expression.value)))
      );
      return { motion, expression, play, loop, loopStatus, error };
    });
    this.select();
  }

  select() {
    const model = this.#getModel();
    for (const { motion, expression } of this.#pickers) {
      const motions = model?.motions.map(({ label }, index) => new Option(label, index)) ?? [];
      motion.replaceChildren(...(motions.length ? motions : [new Option(t("noMotion"), -1)]));
      expression.replaceChildren(new Option(t("noExpression"), -1),
        ...(model?.expressions.map((label, index) => new Option(label, index)) ?? []));
    }
    this.sync();
  }

  sync() {
    const model = this.#getModel();
    for (const { motion, expression, play, loop, loopStatus, error } of this.#pickers) {
      motion.disabled = !model?.motions.length || model.loadingMotion;
      play.disabled = motion.disabled || model.motionChoice < 0;
      loop.disabled = motion.disabled;
      loop.checked = model?.loopMotion ?? true;
      loopStatus.textContent = t(loop.checked ? "loopOn" : "loopOff");
      expression.disabled = !model?.expressions.length || model.loadingExpression;
      motion.value = model?.motionChoice ?? -1;
      expression.value = model?.expressionChoice ?? -1;
      motion.title = motion.selectedOptions[0]?.textContent ?? "";
      expression.title = expression.selectedOptions[0]?.textContent ?? "";
      error.textContent = [model?.motionError, model?.expressionError]
        .filter(Boolean).map((failure) => failure.message ?? String(failure)).join(" ");
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
