const standardDescriptions = new Map(Object.entries({
  ParamAngleX: "头部左右转动",
  ParamAngleY: "头部抬起或低下",
  ParamAngleZ: "头部向两侧倾斜",
  ParamEyeLOpen: "左眼睁开程度",
  ParamEyeROpen: "右眼睁开程度",
  ParamEyeLSmile: "左眼的笑眼程度",
  ParamEyeRSmile: "右眼的笑眼程度",
  ParamEyeBallX: "视线横向位置",
  ParamEyeBallY: "视线纵向位置",
  ParamBrowLY: "左眉上下位置",
  ParamBrowRY: "右眉上下位置",
  ParamBrowLX: "左眉左右位置",
  ParamBrowRX: "右眉左右位置",
  ParamBrowLAngle: "左眉倾斜角度",
  ParamBrowRAngle: "右眉倾斜角度",
  ParamBrowLForm: "左眉形状",
  ParamBrowRForm: "右眉形状",
  ParamMouthForm: "嘴形变化",
  ParamMouthOpenY: "张嘴程度",
  ParamCheek: "脸颊泛红程度",
  ParamBodyAngleX: "身体左右转动",
  ParamBodyAngleY: "身体前后倾斜",
  ParamBodyAngleZ: "身体向两侧倾斜",
  ParamBreath: "呼吸起伏",
  ParamHairFront: "前发摆动",
  ParamHairSide: "侧发摆动",
  ParamHairBack: "后发摆动",
}));

export function describeParameter(id, modelDescriptions) {
  return modelDescriptions.get(id) ?? standardDescriptions.get(id) ?? "模型未提供此参数的描述";
}

export async function readParameterDescriptions(source, reference) {
  const descriptions = new Map();
  if (typeof reference !== "string" || !reference) return descriptions;

  try {
    const response = await fetch(source.fileURL(reference));
    if (!response.ok) return descriptions;
    const { Parameters } = await response.json();
    if (!Array.isArray(Parameters)) return descriptions;
    for (const item of Parameters) {
      if (!item || typeof item.Id !== "string") continue;
      const description = [item.Description, item.Name]
        .find((value) => typeof value === "string" && value.trim() && value.trim() !== item.Id);
      if (description) descriptions.set(item.Id, description.trim());
    }
  } catch {
    // Display information is optional.
  }
  return descriptions;
}
