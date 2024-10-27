-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPERVISOR', 'RECEPTION', 'WORKSHOP');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'IN_PROCESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Companies" (
    "company_id" SERIAL NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_phone" TEXT,
    "company_email" TEXT,
    "company_address" TEXT,

    CONSTRAINT "Companies_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "Clients" (
    "client_id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,

    CONSTRAINT "Clients_pkey" PRIMARY KEY ("client_id")
);

-- CreateTable
CREATE TABLE "Roles" (
    "role_id" SERIAL NOT NULL,
    "role_name" "UserRole" NOT NULL,

    CONSTRAINT "Roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "Users" (
    "user_id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "Orders" (
    "order_id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "creation_date" TIMESTAMP(3) NOT NULL,
    "delivery_date" TIMESTAMP(3),

    CONSTRAINT "Orders_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "Order_History" (
    "history_id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "previous_status" "OrderStatus" NOT NULL,
    "new_status" "OrderStatus" NOT NULL,
    "change_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_History_pkey" PRIMARY KEY ("history_id")
);

-- CreateTable
CREATE TABLE "Material_Types" (
    "type_id" SERIAL NOT NULL,
    "type_name" TEXT NOT NULL,

    CONSTRAINT "Material_Types_pkey" PRIMARY KEY ("type_id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "inventory_id" SERIAL NOT NULL,
    "type_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "last_update" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("inventory_id")
);

-- CreateTable
CREATE TABLE "Order_Materials" (
    "order_id" INTEGER NOT NULL,
    "inventory_id" INTEGER NOT NULL,
    "quantity_used" INTEGER NOT NULL,

    CONSTRAINT "Order_Materials_pkey" PRIMARY KEY ("order_id","inventory_id")
);

-- CreateTable
CREATE TABLE "Logs" (
    "log_id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "log_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,

    CONSTRAINT "Logs_pkey" PRIMARY KEY ("log_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_username_key" ON "Users"("username");

-- AddForeignKey
ALTER TABLE "Clients" ADD CONSTRAINT "Clients_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Companies"("company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "Roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Orders" ADD CONSTRAINT "Orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Clients"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Orders" ADD CONSTRAINT "Orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "Users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order_History" ADD CONSTRAINT "Order_History_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Orders"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "Material_Types"("type_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order_Materials" ADD CONSTRAINT "Order_Materials_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Orders"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order_Materials" ADD CONSTRAINT "Order_Materials_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "Inventory"("inventory_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Logs" ADD CONSTRAINT "Logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "Users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
