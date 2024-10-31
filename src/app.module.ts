import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CompanyModule } from './company/company.module';
import { ClientModule } from './client/client.module';
import { RoleModule } from './role/role.module';
import { UserModule } from './user/user.module';
import { StatusModule } from './status/status.module';
import { OrderModule } from './order/order.module';
import { OrderHistoryModule } from './order-history/order-history.module';
import { ProductTypeModule } from './product-type/product-type.module';
import { ColorModule } from './color/color.module';
import { SizeModule } from './size/size.module';
import { ProductModule } from './product/product.module';
import { InventoryTransactionModule } from './inventory-transaction/inventory-transaction.module';
import { OrderProductModule } from './order-product/order-product.module';
import { LogModule } from './log/log.module';

@Module({
  imports: [
    PrismaModule,
    CompanyModule,
    ClientModule,
    RoleModule,
    UserModule,
    StatusModule,
    OrderModule,
    OrderHistoryModule,
    ProductTypeModule,
    ColorModule,
    SizeModule,
    ProductModule,
    InventoryTransactionModule,
    OrderProductModule,
    LogModule,
  ],
})
export class AppModule {}
