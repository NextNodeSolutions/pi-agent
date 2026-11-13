import { safePaceText } from './request.ts'

export type ConsentExchange = { question: string; reply: string }

const QUESTION_CHARS = 3000

/** Every judge of an exchange reads the same slice of it. */
export function judgedExchange(exchange: ConsentExchange): {
	agentMessage: string
	humanReply: string
} {
	return {
		agentMessage: safePaceText(exchange.question).slice(-QUESTION_CHARS),
		humanReply: safePaceText(exchange.reply),
	}
}
