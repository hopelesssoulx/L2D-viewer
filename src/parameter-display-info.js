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

export const standardParameterGroups = [
  "ParamGroupFace",
  "ParamGroupHead",
  "ParamGroupEyes",
  "ParamGroupEyeballs",
  "ParamGroupBrows",
  "ParamGroupMouth",
  "ParamGroupBody",
  "ParamGroupHands",
  "ParamGroupHandL",
  "ParamGroupHandR",
  "ParamGroupArms",
  "ParamGroupArmL",
  "ParamGroupArmR",
  "ParamGroupLegs",
  "ParamGroupLegL",
  "ParamGroupLegR",
  "ParamGroupSway",
  "ParamGroupExpression",
  "ParamGroupHair",
  "ParamGroupOverall",
];

const pairedGroups = new Map(Object.entries({
  ParamGroupHands: ["ParamGroupHandL", "ParamGroupHandR"],
  ParamGroupArms: ["ParamGroupArmL", "ParamGroupArmR"],
  ParamGroupLegs: ["ParamGroupLegL", "ParamGroupLegR"],
}));

// Standard Cubism IDs and common variants for models without display groups.
// The patterns for hands, arms, and legs capture the group ID's side suffix.
const parameterGroupPatterns = [
  ["ParamGroupHead", /^paramangle[xyz](?:(?:plus|minus)\d+)?$/],
  ["ParamGroupEyes", /^parameye(?:[lr](?:open|smile|form|scale|highlight)\d*|lid[lr]|form|scale|highlight)$/],
  ["ParamGroupEyeballs", /^param(?:eyeball(?:[xy]|form)|pupil)$/],
  ["ParamGroupBrows", /^parambrow(?:[lr](?:[xy]|angle|form)\d*|display[lr])$/],
  ["ParamGroupMouth", /^parammouth(?:openy|form(?:y|\d+)?|scale)$/],
  ["ParamGroupBody", /^param(?:bodyangle[xyz]|breath|shouldery|upperbody)$/],
  ["ParamGroupHand", /^(?:param)?hand([lr])(?:[a-z]?\d+)?(?:display)?$/],
  ["ParamGroupArm", /^paramarm([lr])(?:[a-z]?\d*|change|layer\d*|\d+contraction)$/],
  ["ParamGroupLeg", /^paramleg([lr])\d*$/],
  ["ParamGroupSway", /^param(?:bust[xy]?|sway)$/],
  ["ParamGroupExpression", /^paramcheek\d*$/],
  ["ParamGroupHair", /^paramhair(?:front|side|back|fluffy|aho)[xy]?\d*$/],
  ["ParamGroupOverall", /^param(?:base[xy]|position[xy]|rotationz|move(?:lr|ud)all|angle[xyz]all)$/],
];

export function inferDisplayGroup(id) {
  const normalized = id.replaceAll("_", "").toLowerCase();
  for (const [group, pattern] of parameterGroupPatterns) {
    const match = pattern.exec(normalized);
    if (match) return group + (match[1]?.toUpperCase() ?? "");
  }
  return "other";
}

export function matchesDisplayGroup(groupId, filter) {
  return !filter || groupId === filter || pairedGroups.get(filter)?.includes(groupId) === true;
}

export function describeParameter(id, modelDescription) {
  return modelDescription ?? standardDescriptions.get(id)?.[getLanguage() === "en" ? 1 : 0] ?? t("noParameterDescription");
}

function resolveDisplayGroup(groupId, parents) {
  const visited = new Set();
  while (groupId && !visited.has(groupId)) {
    if (standardParameterGroups.includes(groupId)) return groupId;
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
      const groupId = typeof item.GroupId === "string" ? item.GroupId.trim() : "";
      info.set(item.Id, {
        description: description?.trim(),
        displayGroup: groupId ? resolveDisplayGroup(groupId, parents) : undefined,
      });
    }
  } catch {
    // Display information is optional.
  }
  return info;
}
