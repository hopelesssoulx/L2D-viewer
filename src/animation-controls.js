import { t } from "./i18n.js";
import { motionOptionLabel } from "./motion-editor.js";

export class AnimationControls {
  #motion;
  #expression;
  #play;
  #edit;
  #loopControls;
  #error;
  #getModel;
  #onPlayback;

  constructor(window, loopTemplate, loopHosts, getModel, onPlayback) {
    this.#getModel = getModel;
    this.#onPlayback = onPlayback;
    this.#motion = window.querySelector("[data-motion-select]");
    this.#expression = window.querySelector("[data-expression-select]");
    this.#play = window.querySelector("[data-play-motion]");
    this.#edit = window.querySelector("[data-edit-motion]");
    this.#error = window.querySelector("[data-animation-error]");
    this.#motion.addEventListener("change", () =>
      this.#run((model) => model.playMotion(Number(this.#motion.value), { resume: false }))
    );
    this.#expression.addEventListener("change", () =>
      this.#run((model) => model.setExpression(Number(this.#expression.value)))
    );
    this.#play.addEventListener("click", () => this.#run((model) => model.playMotion()));
    this.#loopControls = loopHosts.map((host) => {
      host.prepend(loopTemplate.content.cloneNode(true));
      const loop = host.querySelector("[data-motion-loop]");
      const loopStatus = host.querySelector("[data-motion-loop-status]");
      loop.addEventListener("change", () => this.#run((model) => model.setMotionLoop(loop.checked)));
      return { loop, loopStatus };
    });
    this.select();
  }

  select() {
    const model = this.#getModel();
    this.#motion.replaceChildren(new Option(t("noMotion"), -1),
      ...(model?.motions.map((motion, index) => new Option(motionOptionLabel(motion), index)) ?? []));
    this.#expression.replaceChildren(new Option(t("noExpression"), -1),
      ...(model?.expressions.map((label, index) => new Option(label, index)) ?? []));
    this.sync();
  }

  sync() {
    const model = this.#getModel();
    const editing = model?.editingMotion;
    this.#motion.disabled = !model?.motions.length || model.loadingMotion || editing;
    this.#play.disabled = this.#motion.disabled || model.motionChoice < 0;
    this.#expression.disabled = !model?.expressions.length || model.loadingExpression || editing;
    this.#edit.disabled = !model || model.cubism2 || editing || model.loadingMotion || model.loadingExpression;
    this.#edit.title = model?.cubism2 ? t("editorUnavailable") : "";
    this.#motion.value = model?.motionChoice ?? -1;
    this.#expression.value = model?.expressionChoice ?? -1;
    this.#motion.title = this.#motion.selectedOptions[0]?.textContent ?? "";
    this.#expression.title = this.#expression.selectedOptions[0]?.textContent ?? "";
    for (const { loop, loopStatus } of this.#loopControls) {
      loop.disabled = this.#play.disabled;
      loop.checked = model?.loopMotion ?? false;
      loopStatus.textContent = t(loop.checked ? "loopOn" : "loopOff");
    }
    this.#error.textContent = [model?.motionError, model?.expressionError]
      .filter(Boolean).map((failure) => failure.message ?? String(failure)).join(" ");
    this.#error.hidden = !this.#error.textContent;
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
