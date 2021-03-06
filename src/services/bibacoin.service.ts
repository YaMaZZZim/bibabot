import { ContextMessageUpdate } from 'telegraf';
import { Message } from 'telegraf/typings/telegram-types';
import {
  ZERO_BALANCE,
  BibacoinAction,
  NO_BIBA_NO_TRADE,
  DAILY_BIBACOINT_INCOME_PERCENT,
  MAX_DAILY_BIBACOINT_INCOME,
} from '../types/services/bibacoin.service.types';
import { BibacoinCommand, BibacoinDebugCommand } from '../types/globals/commands.types';
import { BotListener, BotCommandType } from '../types/core/bot.types';
import BibacoinRepository from '../repositories/bibacoin.repo';
import BaseService from './base.service';
import DeleteRequestMessage from '../decorators/delete.request.message.decorator';
import DeleteLastMessage from '../decorators/delete.last.message.decorator';
import BibaRepository from '../repositories/biba.repo';
import * as shopUtils from '../utils/shop.util';
import ReplyWithError from '../decorators/reply.with.error.decorator';
import RepliableError from '../types/globals/repliable.error';

export default class BibacoinService extends BaseService {
  private static instance: BibacoinService;

  private constructor(
    private readonly bibacoinRepo: BibacoinRepository,
    private readonly bibaRepo: BibaRepository,
  ) {
    super();
  }

  public static getInstance(): BibacoinService {
    if (!BibacoinService.instance) {
      BibacoinService.instance = new BibacoinService(
        new BibacoinRepository(),
        new BibaRepository(),
      );
    }

    return BibacoinService.instance;
  }

  @DeleteRequestMessage()
  @DeleteLastMessage('income')
  private static async sendIncomeList(ctx: ContextMessageUpdate): Promise<Message> {
    const list = shopUtils.getActivitiesList();

    return ctx.reply(list.map((activity) => `${shopUtils.getActivityContext(activity)}`).join('\n'));
  }

  public async addMessageCoins(ctx: ContextMessageUpdate, next: Function | undefined): Promise<Function> {
    if (!ctx.message) return next!();

    const chatId = ctx.chat!.id;
    const userId = ctx.message.from!.id;
    const messagePrice = shopUtils.getPriceByMessage(ctx.message);

    await this.addCoins(userId, chatId, messagePrice);

    return next!();
  }

  public async dailyIncome(chatId: number): Promise<void> {
    const balances = await this.bibacoinRepo.getAllBalancesByChatId(chatId);
    await Promise.all(Object.keys(balances).map(async (userId) => {
      const currentBalance = balances[userId];
      let newBalance = currentBalance * ((100 + DAILY_BIBACOINT_INCOME_PERCENT) / 100);

      if (newBalance - currentBalance > MAX_DAILY_BIBACOINT_INCOME) {
        newBalance = currentBalance + MAX_DAILY_BIBACOINT_INCOME;
      }

      await this.bibacoinRepo.setBibacoinBalance(
        chatId,
        parseInt(userId, 10),
        newBalance.toFixed(),
      );
    }));
  }

  public async addCoins(userId: number, chatId: number, value: number): Promise<void> {
    const currentBalance = await this.bibacoinRepo.getBibacoinBalanceByIds(chatId, userId);
    const newBalance = currentBalance + value;
    await this.bibacoinRepo.setBibacoinBalance(chatId, userId, newBalance);
  }

  public async hasEnoughCredits(userId: number, chatId: number, value: number): Promise<boolean> {
    const currentBalance = await this.bibacoinRepo.getBibacoinBalanceByIds(chatId, userId);

    if (currentBalance >= value) {
      return true;
    }

    throw new Error(`Недостаточно бибакоинов. Требуется ${value}, у тебя ${currentBalance}`);
  }

  public async withdrawCoins(userId: number, chatId: number, value: number): Promise<number> {
    const currentBalance = await this.bibacoinRepo.getBibacoinBalanceByIds(chatId, userId);

    const newBalance = currentBalance - value;
    await this.bibacoinRepo.setBibacoinBalance(chatId, userId, newBalance);

    return newBalance;
  }

  protected initListeners(): void {
    const commands: BotListener[] = [
      {
        type: BotCommandType.COMMAND,
        name: BibacoinCommand.INCOME_LIST,
        callback: (ctx): Promise<Message> => BibacoinService.sendIncomeList(ctx),
      },
      {
        type: BotCommandType.COMMAND,
        name: BibacoinCommand.GIVE,
        callback: (ctx): Promise<Message> => this.giveCoins(ctx),
      },
      {
        type: BotCommandType.ACTION,
        name: BibacoinAction.BALANCE,
        callback: (ctx): Promise<void> => this.getBalance(ctx),
      },
    ];

    if (process.env.PRODUCTION === 'false') {
      commands.push(
        { type: BotCommandType.COMMAND, name: BibacoinDebugCommand.SET_BALANCE, callback: (ctx) => this.setBalance(ctx) },
      );
    }

    this.bot.addListeners(commands);
  }

  @DeleteRequestMessage()
  @ReplyWithError()
  private async giveCoins(ctx: ContextMessageUpdate): Promise<Message> {
    const params = ctx.message!.text!.split(' ');
    const chatId = ctx.chat!.id;
    const fromUserId = ctx.from!.id;
    const username = params[1];
    const count = parseFloat(params[2]);
    if (!username || count === undefined || Number.isNaN(count)) throw new RepliableError('Wrong format', ctx);
    if (count % 1 !== 0) throw new RepliableError('Нельзя передавать дробное количество бибакоинов', ctx);

    const fromUser = await this.bibaRepo.getBibaByIds(chatId, fromUserId);

    if (!fromUser) throw new RepliableError(NO_BIBA_NO_TRADE, ctx);
    if (count <= 0) throw new RepliableError(`${fromUser.username} нельзя передать меньше 1 бибакоина`, ctx);

    const toUser = await this.bibaRepo.findBibaByUsernameInChat(chatId, username);

    if (!toUser) throw new RepliableError(NO_BIBA_NO_TRADE, ctx);
    if (fromUser.username === toUser.username) {
      throw new RepliableError(`${fromUser.username} ты не можешь передать коины самому себе`, ctx);
    }

    const fromUserBalance = await this.bibacoinRepo.getBibacoinBalanceByIds(chatId, fromUserId);
    const fromUserNewBalance = fromUserBalance - count;

    if (fromUserNewBalance < 0) throw new RepliableError(`${fromUser.username} ты не можешь отдать больше, чем у тебя есть`, ctx);

    await this.bibacoinRepo.setBibacoinBalance(chatId, fromUserId, fromUserNewBalance);
    await this.addCoins(toUser.userId, chatId, count);

    return ctx.reply(`${toUser.username} получил ${count} бибакоинов от ${fromUser.username}. Не забудь сказать спасибо`);
  }

  private async setBalance(ctx: ContextMessageUpdate): Promise<Message> {
    const balance = ctx.message!.text!.split(BibacoinDebugCommand.SET_BALANCE)[1].trim();

    if (!balance) {
      return ctx.reply('Укажи сколько надо');
    }

    await this.bibacoinRepo.setBibacoinBalance(ctx.chat!.id, ctx.message!.from!.id, balance);
    return ctx.reply('Done');
  }

  private async getBalance(ctx: ContextMessageUpdate): Promise<void> {
    const balance = await this.bibacoinRepo.getBibacoinBalanceByIds(ctx.chat!.id, ctx.from!.id);
    const message = balance ? `У тебя на счету ${balance} бибакоинов` : ZERO_BALANCE;
    await ctx.answerCbQuery(message, true);
  }
}
