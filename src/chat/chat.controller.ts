import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ChatService, ChatRequestingUser } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateDirectConversationDto } from './dto/create-direct-conversation.dto';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';

/** Traduce el payload del token al usuario que consume ChatService. */
function requestingUser(user: AccessTokenPayload): ChatRequestingUser {
  return { userId: user.sub, roles: user.roles ?? [] };
}

@Auth(
  Role.ADMIN,
  Role.SUPERUSER,
  Role.RECEPCION,
  Role.TALLER,
  Role.DTF,
  Role.BORDADO,
  Role.DISENO,
  Role.LASER,
  Role.IMPRESIONES,
)
@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  findConversations(@ActiveUser() user: AccessTokenPayload) {
    return this.chatService.findConversationsForUser(requestingUser(user));
  }

  @Get('unread-count')
  unreadCount(@ActiveUser() user: AccessTokenPayload) {
    return this.chatService.unreadCount(requestingUser(user));
  }

  @Get('users')
  findChatUsers(@ActiveUser() user: AccessTokenPayload) {
    return this.chatService.findChatUsers(requestingUser(user));
  }

  @Post('conversations/direct')
  createDirect(
    @Body() dto: CreateDirectConversationDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.chatService.getOrCreateDirectConversation(
      dto.userId,
      requestingUser(user),
    );
  }

  @Get('conversations/:id/messages')
  findMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PaginationQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.chatService.findMessages(id, requestingUser(user), query);
  }

  @Get('conversations/:id/members')
  findMembers(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.chatService.findMembers(id, requestingUser(user));
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.chatService.sendMessage(
      id,
      dto.body,
      requestingUser(user),
      dto.orderId,
    );
  }

  @Post('conversations/:id/read')
  markAsRead(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.chatService.markConversationAsRead(id, requestingUser(user));
  }
}
