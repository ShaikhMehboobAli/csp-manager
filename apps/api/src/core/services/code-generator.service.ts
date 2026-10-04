import crypto from "crypto";

import RunningNumberRepository from "../repositories/running-number.repository";

import { RunningNumberType } from "../../generated/prisma/enums";

export default class CodeGeneratorService {
  constructor(
    private readonly runningNumberRepository: RunningNumberRepository,
  ) {}

  async generateSubscriptionNumber() {
    return this.generateSequentialNumber(RunningNumberType.SUBSCRIPTION, "SUB");
  }

  async generatePaymentNumber() {
    return this.generateSequentialNumber(RunningNumberType.PAYMENT, "PAY");
  }

  async generateInvoiceNumber() {
    return this.generateSequentialNumber(RunningNumberType.INVOICE, "INV");
  }

  generateActivationCode(length = 16) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    while (code.length < length) {
      code += chars[crypto.randomInt(0, chars.length)];
    }

    return code.match(/.{1,4}/g)?.join("-") ?? code;
  }

  private async generateSequentialNumber(
    type: RunningNumberType,
    prefix: string,
  ) {
    const nextValue = await this.runningNumberRepository.getNextValue(type);

    const year = new Date().getFullYear();

    return `${prefix}-${year}-${nextValue.toString().padStart(6, "0")}`;
  }

  async generateMachineCode() {
    return this.generateSequentialNumber(RunningNumberType.MACHINE, "MAC");
  }

  async generateMachineSessionCode() {
    return this.generateSequentialNumber(
      RunningNumberType.MACHINE_SESSION,
      "MSE",
    );
  }

  async generateReceiptNumber() {
    return this.generateSequentialNumber(RunningNumberType.RECEIPT, "REC");
  }

  async generateCspVisitNumber() {
    return this.generateSequentialNumber(RunningNumberType.CSP_VISIT, "VIS");
  }
}
