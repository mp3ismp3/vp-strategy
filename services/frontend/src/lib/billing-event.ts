interface ProviderEventLike {
  id?: unknown;
  created?: unknown;
  livemode?: unknown;
  data?: { object?: unknown };
}

export function minimizeBillingEventPayload(event: ProviderEventLike) {
  const object = event.data?.object;
  const objectId = object && typeof object === "object" && "id" in object && typeof object.id === "string"
    ? object.id
    : null;
  return {
    objectId,
    created: typeof event.created === "number" ? event.created : null,
    livemode: typeof event.livemode === "boolean" ? event.livemode : null,
  };
}

export function minimizeEcpayEventPayload(fields: Record<string, string>) {
  return {
    merchantTradeNo: fields.MerchantTradeNo ?? null,
    tradeNo: fields.TradeNo ?? null,
    rtnCode: fields.RtnCode ?? null,
    amount: fields.PeriodAmount ?? fields.TradeAmt ?? fields.amount ?? null,
    totalSuccessTimes: fields.TotalSuccessTimes ?? null,
  };
}
