/**
 * 售前测试集：10 条假设客户画像，按常见企业智能体售前场景编写。
 * 不是真实签约客户，也不对应仓库里的某篇文档。
 */
import type { PreSalesIntake } from "./presales.js";

export interface PresalesTestCase {
  id: string;
  title: string;
  /** 列表上的一行说明。 */
  blurb: string;
  intake: PreSalesIntake;
}

export interface PresalesTestRecord {
  caseId: string;
  filledAt?: number;
  submittedAt?: number;
}

export const PRESALES_TEST_CASES: readonly PresalesTestCase[] = [
  {
    id: "bank-card-cs",
    title: "滨江城商行信用卡中心",
    blurb: "坐席查积分、拒付和分期口径，制度散在多个 PDF。",
    intake: {
      customerName: "滨江城商行信用卡中心",
      industry: "银行 / 信用卡客服",
      audience: ["cs", "manager"],
      problem: ["slowLookup", "unstableProcess"],
      expectedOutput: "qa",
      sceneNarrative: "一线坐席处理争议账务时要翻多份制度，口径不统一，主管抽查也缺少统一话术。",
    },
  },
  {
    id: "hospital-guide",
    title: "江城省立医院门诊部",
    blurb: "患者问挂号、检查地点和空腹要求，导诊台重复解答。",
    intake: {
      customerName: "江城省立医院门诊部",
      industry: "医疗 / 门诊导诊",
      audience: ["customer", "cs"],
      problem: ["tooMuchManual", "poorUx"],
      expectedOutput: "qa",
      sceneNarrative:
        "门诊高峰时导诊反复回答挂号路径、检查地点和注意事项，书面指南更新后一线记不住。",
    },
  },
  {
    id: "auto-aftersales",
    title: "临江合资车企售后技术支持",
    blurb: "维修技师查电路图和召回说明，电话排队问专家。",
    intake: {
      customerName: "临江合资车企售后技术支持",
      industry: "汽车 / 售后技术",
      audience: ["ops", "employee"],
      problem: ["slowLookup", "tooMuchManual"],
      expectedOutput: "qa",
      sceneNarrative:
        "经销商技师修车时要在维修手册和召回公告里找步骤，找不到就打电话给厂家技术支持。",
    },
  },
  {
    id: "gov-hotline",
    title: "澄海市政务服务热线",
    blurb: "办事指南版本多，话务员口径和窗口不一致。",
    intake: {
      customerName: "澄海市政务服务热线",
      industry: "政务 / 12345 热线",
      audience: ["cs", "customer"],
      problem: ["unstableProcess", "slowLookup"],
      expectedOutput: "qa",
      sceneNarrative:
        "市民来电问材料清单和办理时限，话务员与窗口使用的指南不是同一版，投诉集中在口径不一致。",
    },
  },
  {
    id: "retail-ops",
    title: "禾风连锁超市营运部",
    blurb: "店长查促销规则和损耗处理，靠区域督导口头传达。",
    intake: {
      customerName: "禾风连锁超市营运部",
      industry: "零售 / 门店营运",
      audience: ["ops", "manager"],
      problem: ["unstableProcess", "lowEfficiency"],
      expectedOutput: "qa",
      sceneNarrative:
        "门店店长执行促销和报损时规则经常变，群消息盖过制度，新店长上手要靠老店长带。",
    },
  },
  {
    id: "insurance-claim",
    title: "北湾财产险理赔共享中心",
    blurb: "理赔员核对条款和材料清单，个案判断差异大。",
    intake: {
      customerName: "北湾财产险理赔共享中心",
      industry: "保险 / 车险理赔",
      audience: ["ops", "manager"],
      problem: ["tooMuchManual", "slowLookup"],
      expectedOutput: "workflow",
      sceneNarrative:
        "理赔员接到报案后要核对险种条款和应缴材料，简单案件仍大量人工判断，同类案件结论不稳定。",
    },
  },
  {
    id: "cross-border-cs",
    title: "南栈跨境电商商家客服",
    blurb: "买家问物流时效和退货规则，站点政策经常改。",
    intake: {
      customerName: "南栈跨境电商商家客服",
      industry: "电商 / 跨境客服",
      audience: ["cs", "customer"],
      problem: ["poorUx", "unstableProcess"],
      expectedOutput: "qa",
      sceneNarrative:
        "买家咨询物流节点、关税和退货窗口，客服要在多个站点政策页之间切换，回复慢且容易用过期规则。",
    },
  },
  {
    id: "factory-maint",
    title: "青禾离散制造设备科",
    blurb: "夜班维修查故障手册，老师傅不在就停线。",
    intake: {
      customerName: "青禾离散制造设备科",
      industry: "制造 / 设备运维",
      audience: ["ops", "employee"],
      problem: ["slowLookup", "tooMuchManual"],
      expectedOutput: "qa",
      sceneNarrative:
        "产线报警后维修工要在纸质手册和厂家 PDF 里对故障码，夜班缺少老师傅时停线时间变长。",
    },
  },
  {
    id: "university-affairs",
    title: "望湖学院教务处",
    blurb: "学生问选课、缓考和学分认定，窗口重复解释。",
    intake: {
      customerName: "望湖学院教务处",
      industry: "教育 / 教务",
      audience: ["customer", "employee"],
      problem: ["tooMuchManual", "poorUx"],
      expectedOutput: "qa",
      sceneNarrative:
        "选课周学生集中询问培养方案、缓考和学分认定，教务老师反复解释同一份通知，电话占线。",
    },
  },
  {
    id: "broker-assistant",
    title: "浦石证券营业部投顾助理",
    blurb: "助理查产品说明书和适当性话术，不能口头承诺收益。",
    intake: {
      customerName: "浦石证券营业部投顾助理",
      industry: "证券 / 营业部",
      audience: ["sales", "cs"],
      problem: ["slowLookup", "unstableProcess"],
      expectedOutput: "riskList",
      sceneNarrative:
        "投顾助理接待客户时要核对产品说明书和适当性要求，话术不统一，且不能编造收益或买卖建议。",
    },
  },
];

export const PRESALES_TEST_RECORD_KEY = "fde.presalesTestRecords.v1";
