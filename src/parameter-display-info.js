import { getLanguage, t } from "./i18n.js";

const standardDescriptions = new Map(Object.entries({
  ParamAngleX: ["头部左右转动", "Head turn left or right"],
  ParamAngleY: ["头部抬起或低下", "Head tilt up or down"],
  ParamAngleZ: ["头部向两侧倾斜", "Head tilt to either side"],
  ParamEyeLOpen: ["左眼睁开程度", "Left eye openness"],
  ParamEyeROpen: ["右眼睁开程度", "Right eye openness"],
  ParamEyeLSmile: ["左眼的笑眼程度", "Left eye smile"],
  ParamEyeRSmile: ["右眼的笑眼程度", "Right eye smile"],
  ParamEyeBallX: ["视线横向位置", "Horizontal gaze"],
  ParamEyeBallY: ["视线纵向位置", "Vertical gaze"],
  ParamBrowLY: ["左眉上下位置", "Left eyebrow height"],
  ParamBrowRY: ["右眉上下位置", "Right eyebrow height"],
  ParamBrowLX: ["左眉左右位置", "Horizontal left eyebrow position"],
  ParamBrowRX: ["右眉左右位置", "Horizontal right eyebrow position"],
  ParamBrowLAngle: ["左眉倾斜角度", "Left eyebrow angle"],
  ParamBrowRAngle: ["右眉倾斜角度", "Right eyebrow angle"],
  ParamBrowLForm: ["左眉形状", "Left eyebrow shape"],
  ParamBrowRForm: ["右眉形状", "Right eyebrow shape"],
  ParamMouthForm: ["嘴形变化", "Mouth shape"],
  ParamMouthOpenY: ["张嘴程度", "Mouth openness"],
  ParamCheek: ["脸颊泛红程度", "Cheek blush"],
  ParamBodyAngleX: ["身体左右转动", "Body turn left or right"],
  ParamBodyAngleY: ["身体前后倾斜", "Body lean forward or back"],
  ParamBodyAngleZ: ["身体向两侧倾斜", "Body tilt to either side"],
  ParamBreath: ["呼吸起伏", "Breathing"],
  ParamHairFront: ["前发摆动", "Front hair sway"],
  ParamHairSide: ["侧发摆动", "Side hair sway"],
  ParamHairBack: ["后发摆动", "Back hair sway"],
}));

const displayGroups = new Map(Object.entries({
  ParamGroupFace: "head",
  ParamGroupHead: "head",
  ParamGroupEyes: "eyes",
  ParamGroupEyeballs: "eyes",
  ParamGroupBrows: "brows",
  ParamGroupMouth: "mouth",
  ParamGroupExpression: "expression",
  ParamGroupBody: "body",
  ParamGroupArms: "arms",
  ParamGroupArmL: "arms",
  ParamGroupArmR: "arms",
  ParamGroupHands: "hands",
  ParamGroupHandL: "hands",
  ParamGroupHandR: "hands",
  ParamGroupHair: "hair",
  // Cubism has no recommended ID for clothing.
  ParamGroupClothing: "clothing",
  ParamGroupClothes: "clothing",
}));

export function describeParameter(id, modelDescription) {
  return modelDescription ?? standardDescriptions.get(id)?.[getLanguage() === "en" ? 1 : 0] ?? t("noParameterDescription");
}

function resolveDisplayGroup(groupId, parents) {
  const visited = new Set();
  while (groupId && !visited.has(groupId)) {
    const group = displayGroups.get(groupId);
    if (group) return group;
    visited.add(groupId);
    groupId = parents.get(groupId);
  }
  return "other";
}

export async function readParameterDisplayInfo(source, reference) {
  const info = new Map();
  if (typeof reference !== "string" || !reference) return info;

  try {
    const response = await fetch(source.fileURL(reference));
    if (!response.ok) return info;
    const { Parameters, ParameterGroups } = await response.json();
    if (!Array.isArray(Parameters)) return info;

    const parents = new Map();
    for (const group of Array.isArray(ParameterGroups) ? ParameterGroups : []) {
      if (typeof group?.Id === "string") parents.set(group.Id, group.GroupId);
    }

    for (const item of Parameters) {
      if (!item || typeof item.Id !== "string") continue;
      const description = [item.Description, item.Name]
        .find((value) => typeof value === "string" && value.trim() && value.trim() !== item.Id);
      info.set(item.Id, {
        description: description?.trim(),
        displayGroup: resolveDisplayGroup(item.GroupId, parents),
      });
    }
  } catch {
    // Display information is optional.
  }
  return info;
}
